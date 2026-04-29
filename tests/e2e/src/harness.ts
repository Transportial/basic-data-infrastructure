// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  createServer as createAsrServer,
  type AsrConfig,
  type AsrServer,
} from '@transportial/asr';
import {
  createServer as createOrsServer,
  type OrsConfig,
} from '@transportial/ors';
import {
  createServer as createConServer,
  type ConConfig,
} from '@transportial/con';
import { HmacSigner, InMemoryTrustlist } from '@transportial/crypto';
import { JwsSigner as AsrJwsSigner } from '@transportial/asr/infrastructure/crypto/signer.ts';

import { Network, type ServiceFetch } from './network.ts';
import { ServiceClient } from './clients.ts';
import { AlwaysSuccessfulVerificationSource } from './verification-sources.ts';

export interface HarnessOptions {
  // Issuer/base URLs used both as the configured issuer for each service AND
  // as the host the in-process network routes to. Defaults to *.bdi.test so
  // they're obviously synthetic.
  readonly asrIssuer?: string;
  readonly orsIssuer?: string;
  readonly conBaseUrl?: string;

  // Association/identity identifiers shared across the harness.
  readonly associationId?: string;
  readonly ownConnectorId?: string;
  readonly ownMemberEuid?: string;

  // Per-service overrides — tests can pass through extra config without the
  // harness needing to know about every field.
  readonly asr?: Partial<AsrConfig>;
  readonly ors?: Partial<OrsConfig>;
  readonly con?: Partial<ConConfig>;
}

// Symmetric HMAC signer + matching kid. Tests can mint BVAD/BVOD tokens with
// these directly; the trustlists handed to CON are pre-populated with the
// same key under the same kid so verification succeeds.
export interface HarnessSigner {
  readonly kid: string;
  readonly signer: HmacSigner;
}

export interface BdiHarness {
  readonly network: Network;
  readonly asr: ServiceClient;
  readonly ors: ServiceClient;
  readonly con: ServiceClient;
  readonly composition: {
    readonly asr: AsrServer['composition'];
    readonly ors: ReturnType<typeof createOrsServer>['composition'];
    readonly con: ReturnType<typeof createConServer>['composition'];
  };
  readonly issuers: {
    readonly asr: string;
    readonly ors: string;
    readonly con: string;
  };
  readonly associationId: string;
  readonly ownConnectorId: string;
  readonly ownMemberEuid: string;
  readonly audience: string;
  readonly signers: {
    readonly asr: HarnessSigner;
    readonly ors: HarnessSigner;
  };

  // Register an arbitrary in-process service against `baseUrl` so other
  // services can call into it through the harness network. Useful for
  // standing up a fake webhook receiver.
  registerService(baseUrl: string, fetch: ServiceFetch): ServiceClient;

  // Stop schedulers etc. Idempotent.
  stop(): Promise<void>;
}

// Boot ASR + ORS + CON in-process and wire them onto a shared in-process
// network so that:
//   - tests can invoke each service through `harness.asr.post(...)` etc.
//   - CON's outbound HTTP client routes through the same network, so webhook
//     deliveries can be observed without real sockets.
//   - inter-service URLs (ASR issuer, ORS issuer) match the URLs each service
//     has been configured with, so tokens issued by one service can be
//     verified by another.
//   - ASR's BVAD signer and ORS's BVOD signer share their key material with
//     CON's trustlists, so a real cross-service round-trip (issue here →
//     verify there) succeeds without any per-test setup.
export async function createHarness(options: HarnessOptions = {}): Promise<BdiHarness> {
  const associationId = options.associationId ?? 'ctn';
  const asrIssuer = options.asrIssuer ?? 'https://asr.bdi.test';
  const orsIssuer = options.orsIssuer ?? 'https://ors.bdi.test';
  const conBaseUrl = options.conBaseUrl ?? 'https://con.bdi.test';
  const ownConnectorId = options.ownConnectorId ?? 'urn:bdi:connector:harness';
  const ownMemberEuid = options.ownMemberEuid ?? 'NL.NHR.99999999';
  const audience = `urn:bdi:association:${associationId}`;

  const network = new Network();

  // Shared HMAC keys — symmetric so the same bytes serve as both signing key
  // (inside ASR/ORS) and verifying key (inside CON's trustlists). HMAC isn't
  // wire-profile-compliant for production, but that's a separate concern from
  // E2E test plumbing — see crypto/src/hmac-signer.ts.
  const asrKid = 'harness-asr-key-1';
  const orsKid = 'harness-ors-key-1';
  const asrKeyBytes = randomKey();
  const orsKeyBytes = randomKey();
  const asrInnerSigner = new HmacSigner(asrKeyBytes);
  const orsInnerSigner = new HmacSigner(orsKeyBytes);

  const asrTrustlist = options.con?.asrTrustlist ?? new InMemoryTrustlist();
  asrTrustlist.add({ kid: asrKid, signer: asrInnerSigner });
  const orsTrustlist = options.con?.orsTrustlist ?? new InMemoryTrustlist();
  orsTrustlist.add({ kid: orsKid, signer: orsInnerSigner });

  // ASR signer wired through the public `fromHmac` factory — the BVAD route
  // signs with this and CON's trustlist verifies with the same bytes.
  const asrSigner = AsrJwsSigner.fromHmac(asrKid, asrKeyBytes);

  const asrServer = await createAsrServer({
    port: 0,
    issuer: asrIssuer,
    associationId,
    signer: asrSigner,
    verificationSources: [
      new AlwaysSuccessfulVerificationSource('KvK'),
      new AlwaysSuccessfulVerificationSource('VIES'),
    ],
    ...(options.asr ?? {}),
  });

  const orsServer = createOrsServer({
    port: 0,
    issuer: orsIssuer,
    signingKid: orsKid,
    signingKey: orsKeyBytes,
    ...(options.ors ?? {}),
  });

  const conServer = createConServer({
    port: 0,
    asrIssuer,
    orsIssuer,
    associationId,
    ownConnectorId,
    ownMemberEuid,
    audience,
    asrTrustlist,
    orsTrustlist,
    httpClient: {
      // Route CON's outbound webhook deliveries through the harness network
      // so other in-process services can observe them.
      async post(url, body, headers) {
        const res = await network.fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers },
        });
        return { status: res.status };
      },
    },
    forwardClient: {
      // Same idea for /proxy-upstream/*: the headered HTTP client used by the
      // proxy use case forwards through the harness network so tests can
      // register fake upstreams.
      async post(url, body, headers) {
        const res = await network.fetch(url, {
          method: 'POST',
          body,
          headers: { ...headers },
        });
        return { status: res.status };
      },
      async request(method, url, body, headers) {
        const init: RequestInit = { method, headers: { ...headers } };
        if (body.length > 0 && method !== 'GET' && method !== 'HEAD') init.body = body;
        const res = await network.fetch(url, init);
        const respHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => void (respHeaders[k] = v));
        const text = await res.text();
        return { status: res.status, headers: respHeaders, body: text };
      },
    },
    ...(options.con ?? {}),
  });

  network.register(asrIssuer, asrServer.fetch);
  network.register(orsIssuer, orsServer.fetch);
  network.register(conBaseUrl, conServer.fetch);

  const harness: BdiHarness = {
    network,
    asr: new ServiceClient('asr', asrIssuer, asrServer.fetch),
    ors: new ServiceClient('ors', orsIssuer, orsServer.fetch),
    con: new ServiceClient('con', conBaseUrl, conServer.fetch),
    composition: {
      asr: asrServer.composition,
      ors: orsServer.composition,
      con: conServer.composition,
    },
    issuers: { asr: asrIssuer, ors: orsIssuer, con: conBaseUrl },
    associationId,
    ownConnectorId,
    ownMemberEuid,
    audience,
    signers: {
      asr: { kid: asrKid, signer: asrInnerSigner },
      ors: { kid: orsKid, signer: orsInnerSigner },
    },

    registerService(baseUrl, fetch) {
      network.register(baseUrl, fetch);
      const name = new URL(baseUrl).host;
      return new ServiceClient(name, baseUrl, fetch);
    },

    async stop() {
      // ASR ships with a key-rotation/cert-renewal scheduler. It is registered
      // but only running if the operator opts in via `startScheduler`. Stop
      // defensively in case a test enabled it.
      try {
        asrServer.composition.scheduler.stop();
      } catch {
        // already stopped — ignore
      }
    },
  };

  return harness;
}

function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}
