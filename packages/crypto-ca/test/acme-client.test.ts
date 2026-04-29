// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect, beforeEach } from 'bun:test';
import { base64UrlEncode, type Jwk } from '@transportial/kernel';
import { generateKeyPair, JwkSigner, publicJwk } from '@transportial/crypto';
import {
  AcmeClient,
  buildAcmeHttp,
  InMemoryAccountRepository,
  InMemoryAuthorizationRepository,
  InMemoryCertificateRepository,
  InMemoryEabStore,
  InMemoryNonceStore,
  InMemoryOrderRepository,
  JwkCaSigner,
  StaticDnsChallengeVerifier,
  StaticHttpChallengeVerifier,
  StaticTlsAlpnChallengeVerifier,
  type AcmeServerConfig,
  type AcmeServices,
  type ChallengeSolver,
} from '../src/index.ts';
import {
  bitString,
  concat,
  integer,
  oid,
  octetString,
  sequence,
  set,
  tlv,
  utf8,
} from '../src/der.ts';
import { OID } from '../src/oid.ts';
import { jwkToSpki } from '../src/spki.ts';

async function buildCsr(privateJwk: Jwk, publicKeyJwk: Jwk, sans: string[]): Promise<Uint8Array> {
  const subject = sequence(set(sequence(oid(OID.commonName), utf8(sans[0] ?? 'x'))));
  const spki = jwkToSpki(publicKeyJwk);
  const sanExt = sequence(
    oid(OID.extSubjectAltName),
    octetString(sequence(...sans.map((s) => tlv(0x82, new TextEncoder().encode(s))))),
  );
  const extReq = sequence(oid(OID.extensionRequest), set(sequence(sanExt)));
  const attributes = tlv(0xa0, concat(extReq));
  const tbs = sequence(integer(0), subject, spki, attributes);
  const sigAlg = sequence(oid(OID.ecdsaWithSha256));
  const signer = new JwkSigner(privateJwk, 'ES256');
  const sig = await signer.sign(tbs);
  return sequence(tbs, sigAlg, bitString(sig));
}

async function buildInMemoryServer() {
  const caPair = await generateKeyPair('ES256');
  const signer = JwkCaSigner.from(caPair.privateJwk, 'ES256');
  const http = new StaticHttpChallengeVerifier();
  const dns = new StaticDnsChallengeVerifier();
  const tlsAlpn = new StaticTlsAlpnChallengeVerifier();
  const eab = new InMemoryEabStore();
  const config: AcmeServerConfig = {
    directoryBaseUrl: 'https://asr.test',
    orderLifetimeSeconds: 3600,
    authorizationLifetimeSeconds: 3600,
    certificateLifetimeSeconds: 86400,
    caIssuerDn: { commonName: 'BDI CA', country: 'NL' },
    caPublicJwk: publicJwk(caPair.publicJwk),
    crlDistributionUrl: 'https://asr.test/crl',
    ocspUrl: 'https://asr.test/ocsp',
    caIssuersUrl: 'https://asr.test/ca.crt',
    challengeTypes: ['http-01', 'dns-01'],
  };
  let counter = 0;
  const services: AcmeServices = {
    accounts: new InMemoryAccountRepository(),
    orders: new InMemoryOrderRepository(),
    authorizations: new InMemoryAuthorizationRepository(),
    certificates: new InMemoryCertificateRepository(),
    nonces: new InMemoryNonceStore(),
    eab,
    http01: http,
    dns01: dns,
    tlsAlpn01: tlsAlpn,
    signer,
    clock: {
      nowIso: () => new Date().toISOString(),
      nowUnix: () => Math.floor(Date.now() / 1000),
    },
    ids: { newId: (prefix) => `${prefix}-${++counter}` },
    config,
  };
  return { handler: buildAcmeHttp(services), services, http, dns, eab };
}

describe('AcmeClient end-to-end against the in-process server', () => {
  let handler: Awaited<ReturnType<typeof buildInMemoryServer>>;
  beforeEach(async () => {
    handler = await buildInMemoryServer();
  });

  test('register → order → http-01 solve → finalize → fetch → revoke', async () => {
    const hmacKey = new Uint8Array(32);
    crypto.getRandomValues(hmacKey);
    handler.eab.register({ kid: 'eab-1', hmacKey, clientId: 'client-1' });

    const transport = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        return handler.handler.handle(req);
      },
    };
    const client = new AcmeClient({ directoryUrl: 'https://asr.test/acme/directory', transport });

    const accountUrl = await client.newAccount({
      contact: ['mailto:ops@example.com'],
      termsOfServiceAgreed: true,
      eab: { kid: 'eab-1', hmacKey },
    });
    expect(accountUrl).toContain('/acme/accounts/');

    const order = await client.newOrder([
      { type: 'dns', value: 'connector.example.com' },
    ]);
    expect(order.status).toBe('pending');

    const httpSolver: ChallengeSolver = {
      canSolve: (type) => type === 'http-01',
      async present(identifier, token, keyAuth) {
        handler.http.set(identifier, token, keyAuth);
      },
    };
    for (const authzUrl of order.authorizations) {
      const authz = await client.getAuthorization(authzUrl);
      await client.solveAndRespond(authz, [httpSolver]);
    }

    const certPair = await generateKeyPair('ES256');
    const csr = await buildCsr(certPair.privateJwk, publicJwk(certPair.publicJwk), [
      'connector.example.com',
    ]);
    const finalOrder = await client.finalize(order, csr);
    expect(finalOrder.status).toBe('valid');
    const pem = await client.fetchCertificate(finalOrder.certificate!);
    expect(pem).toContain('BEGIN CERTIFICATE');

    const serial = finalOrder.certificate!.split('/').pop()!;
    await client.revoke(serial, 4);
    const persisted = await handler.services.certificates.find(serial);
    expect(persisted?.revokedAt).toBeDefined();
  });

  test('fetchNonce works', async () => {
    const transport = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        return handler.handler.handle(req);
      },
    };
    const client = new AcmeClient({ directoryUrl: 'https://asr.test/acme/directory', transport });
    const nonce = await client.fetchNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  test('getDirectory caches', async () => {
    const transport = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        return handler.handler.handle(req);
      },
    };
    const client = new AcmeClient({ directoryUrl: 'https://asr.test/acme/directory', transport });
    const a = await client.getDirectory();
    const b = await client.getDirectory();
    expect(a).toBe(b);
  });
});

// silence unused
void base64UrlEncode;
