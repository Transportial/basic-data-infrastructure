// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { compactSign, JwkSigner, type KeyAlg } from '@transportial/crypto';
import { base64UrlEncode, type Jwk } from '@transportial/kernel';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  type BvadClaims,
  type BvodClaims,
} from '@transportial/contracts';

import type { BdiHarness } from './harness.ts';

// Mint BVAD/BVOD tokens against the harness's shared signers. Tests that need
// to drive CON's verification paths (e.g. /proxy/check, /webhooks/inbound)
// can call these instead of going through the full ASR token-exchange
// dance — the resulting JWS values verify against CON's pre-populated
// trustlists.

export interface MintBvadInput {
  readonly subjectConnectorId: string;
  readonly memberEuid: string;
  readonly legalName?: string;
  readonly thumbprint?: string;
  readonly assurance?: 'substantial' | 'high';
  readonly issuedAtSecondsAgo?: number;
  readonly lifetimeSeconds?: number;
  readonly jti?: string;
  readonly issuerOverride?: string;
  readonly audienceOverride?: string;
  readonly associationOverride?: string;
  readonly statusOverride?: BvadClaims[typeof BVAD_CLAIM_STATUS];
}

export async function mintBvad(harness: BdiHarness, input: MintBvadInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = now - (input.issuedAtSecondsAgo ?? 5);
  const exp = iat + (input.lifetimeSeconds ?? 600);
  const claims: BvadClaims = {
    iss: input.issuerOverride ?? harness.issuers.asr,
    sub: input.subjectConnectorId,
    aud: input.audienceOverride ?? harness.audience,
    iat,
    exp,
    jti: input.jti ?? crypto.randomUUID(),
    [BVAD_CLAIM_ASSOCIATION]: input.associationOverride ?? harness.associationId,
    [BVAD_CLAIM_ORGANISATION]: {
      euid: input.memberEuid,
      legal_name: input.legalName ?? `Member ${input.memberEuid}`,
    },
    [BVAD_CLAIM_CONNECTOR]: {
      id: input.subjectConnectorId,
      x5t_s256: input.thumbprint ?? 'tp',
      bound_on: now - 86_400,
      authorised_by: 'rep',
    },
    [BVAD_CLAIM_ASSURANCE]: {
      level: input.assurance ?? 'high',
      sources: ['KvK'],
    },
    [BVAD_CLAIM_STATUS]: input.statusOverride ?? 'active',
  };
  return compactSign(claims, harness.signers.asr.signer, {
    kid: harness.signers.asr.kid,
    alg: 'ES256',
    typ: 'bvad+jwt',
  });
}

export interface MintBvodInput {
  readonly chainContextId: string;
  readonly subjectConnectorId: string;
  readonly memberEuid: string;
  readonly roles?: ReadonlyArray<string>;
  readonly contextKind?: 'order' | 'transport' | 'shipment' | 'custom';
  readonly identifiers?: ReadonlyArray<{ scheme: string; value: string }>;
  readonly scope?: ReadonlyArray<string>;
  readonly audienceOverride?: string;
  readonly issuerOverride?: string;
  readonly issuedAtSecondsAgo?: number;
  readonly lifetimeSeconds?: number;
  readonly jti?: string;
}

export async function mintBvod(harness: BdiHarness, input: MintBvodInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = now - (input.issuedAtSecondsAgo ?? 5);
  const exp = iat + (input.lifetimeSeconds ?? 600);
  const claims: BvodClaims = {
    iss: input.issuerOverride ?? harness.issuers.ors,
    sub: input.subjectConnectorId,
    aud: input.audienceOverride ?? harness.ownConnectorId,
    iat,
    exp,
    jti: input.jti ?? crypto.randomUUID(),
    [BVOD_CLAIM_ASSOCIATION]: harness.associationId,
    [BVOD_CLAIM_CHAIN_CONTEXT]: {
      id: input.chainContextId,
      kind: input.contextKind ?? 'shipment',
      identifiers: input.identifiers ?? [],
    },
    [BVOD_CLAIM_INVOLVEMENT]: {
      member_euid: input.memberEuid,
      roles: input.roles ?? ['carrier'],
    },
    [BVOD_CLAIM_SCOPE]: input.scope ?? ['read:shipment'],
  };
  return compactSign(claims, harness.signers.ors.signer, {
    kid: harness.signers.ors.kid,
    alg: 'ES256',
    typ: 'bvod+jwt',
  });
}

// RFC 7523 client-credentials assertion. ASR's /oauth2/token verifies these
// against the JWK that was registered with the connector, so tests need real
// asymmetric crypto here — symmetric stand-ins won't survive the verifier.
export interface ClientAssertionInput {
  readonly clientId: string;
  readonly audience: string;
  readonly privateJwk: Jwk;
  readonly alg?: KeyAlg;
  readonly issuedAtSecondsAgo?: number;
  readonly lifetimeSeconds?: number;
}

export async function buildClientAssertion(input: ClientAssertionInput): Promise<string> {
  const alg: KeyAlg = input.alg ?? 'ES256';
  const signer = new JwkSigner(input.privateJwk, alg);
  const now = Math.floor(Date.now() / 1000);
  const iat = now - (input.issuedAtSecondsAgo ?? 5);
  const exp = iat + (input.lifetimeSeconds ?? 600);
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg, typ: 'JWT' })),
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: input.clientId,
        sub: input.clientId,
        aud: input.audience,
        iat,
        exp,
        jti: crypto.randomUUID(),
      }),
    ),
  );
  const sig = await signer.sign(new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}
