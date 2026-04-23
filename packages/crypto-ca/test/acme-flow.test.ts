// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  base64UrlDecode,
  base64UrlEncode,
  jwkThumbprint,
  type Jwk,
} from '@bdi/kernel';
import {
  generateKeyPair,
  JwkSigner,
  publicJwk,
} from '@bdi/crypto';
import {
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
  keyAuthorization,
  type AcmeServerConfig,
  type AcmeServices,
} from '../src/index.ts';
import {
  bitString,
  boolean,
  concat,
  explicit,
  integer,
  octetString,
  oid,
  printableString,
  set,
  sequence,
  tlv,
  utf8,
} from '../src/der.ts';
import { OID } from '../src/oid.ts';
import { jwkToSpki } from '../src/spki.ts';

async function buildCsrForIdentifiers(
  privateJwk: Jwk,
  publicKeyJwk: Jwk,
  identifiers: ReadonlyArray<string>,
): Promise<Uint8Array> {
  // Subject: CN = first identifier
  const cn = identifiers[0] ?? 'example.com';
  const subject = sequence(
    set(sequence(oid(OID.commonName), utf8(cn))),
  );
  const spki = jwkToSpki(publicKeyJwk);

  const sanExt = sequence(
    oid(OID.extSubjectAltName),
    octetString(
      sequence(
        ...identifiers.map((i) => tlv(0x82, new TextEncoder().encode(i))),
      ),
    ),
  );
  const extensionRequestAttr = sequence(
    oid(OID.extensionRequest),
    set(sequence(sanExt)),
  );
  const attributes = tlv(0xa0, concat(extensionRequestAttr));

  const tbsCsr = sequence(integer(0), subject, spki, attributes);
  const sigAlg = sequence(oid(OID.ecdsaWithSha256));
  const signer = new JwkSigner(privateJwk, 'ES256');
  const signature = await signer.sign(tbsCsr);
  return sequence(tbsCsr, sigAlg, bitString(signature));
}

async function eabJwsOver(accountJwk: Jwk, hmacKey: Uint8Array, kid: string): Promise<{
  protected: string;
  payload: string;
  signature: string;
}> {
  const protectedHeader = { kid, alg: 'HS256' };
  const protectedB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(protectedHeader)),
  );
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(accountJwk)),
  );
  const signingInput = new TextEncoder().encode(`${protectedB64}.${payloadB64}`);
  const key = await crypto.subtle.importKey(
    'raw',
    toBuffer(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, toBuffer(signingInput));
  return {
    protected: protectedB64,
    payload: payloadB64,
    signature: base64UrlEncode(new Uint8Array(sig)),
  };
}

async function accountJws(opts: {
  accountSigner: JwkSigner;
  accountJwk: Jwk;
  nonce: string;
  url: string;
  payload: unknown;
  kid?: string;
}): Promise<string> {
  const protectedHeader = opts.kid
    ? { alg: 'ES256', kid: opts.kid, nonce: opts.nonce, url: opts.url }
    : { alg: 'ES256', jwk: opts.accountJwk, nonce: opts.nonce, url: opts.url };
  const protectedB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(protectedHeader)),
  );
  const payloadB64 =
    opts.payload === '' ? '' : base64UrlEncode(new TextEncoder().encode(JSON.stringify(opts.payload)));
  const sig = await opts.accountSigner.sign(
    new TextEncoder().encode(`${protectedB64}.${payloadB64}`),
  );
  return JSON.stringify({
    protected: protectedB64,
    payload: payloadB64,
    signature: base64UrlEncode(sig),
  });
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function buildServices(): Promise<{
  services: AcmeServices;
  http: StaticHttpChallengeVerifier;
  dns: StaticDnsChallengeVerifier;
  tlsAlpn: StaticTlsAlpnChallengeVerifier;
  caPair: Awaited<ReturnType<typeof generateKeyPair>>;
  eab: InMemoryEabStore;
}> {
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
    certificateLifetimeSeconds: 86400 * 90,
    caIssuerDn: {
      commonName: 'BDI ASR CA',
      organization: 'Connekt',
      country: 'NL',
    },
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
  return { services, http, dns, tlsAlpn, caPair, eab };
}

describe('ACME flow', () => {
  let handler: ReturnType<typeof buildAcmeHttp>;
  let services: AcmeServices;
  let http: StaticHttpChallengeVerifier;
  let dns: StaticDnsChallengeVerifier;
  let eab: InMemoryEabStore;

  beforeEach(async () => {
    const built = await buildServices();
    services = built.services;
    http = built.http;
    dns = built.dns;
    eab = built.eab;
    handler = buildAcmeHttp(services);
  });

  async function fetchNonce(): Promise<string> {
    const r = await handler.handle(new Request('https://asr.test/acme/new-nonce', { method: 'HEAD' }));
    return r.headers.get('replay-nonce')!;
  }

  test('directory exposes RFC 8555 endpoints', async () => {
    const res = await handler.handle(new Request('https://asr.test/acme/directory'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newAccount).toContain('/acme/new-account');
    expect(body.newOrder).toContain('/acme/new-order');
    expect(body.revokeCert).toContain('/acme/revoke-cert');
  });

  test('newNonce via GET also works', async () => {
    const res = await handler.handle(new Request('https://asr.test/acme/new-nonce'));
    expect(res.status).toBe(204);
    expect(res.headers.get('replay-nonce')).toBeTruthy();
  });

  test('unknown method → 405', async () => {
    const res = await handler.handle(
      new Request('https://asr.test/acme/new-account', { method: 'DELETE' }),
    );
    expect(res.status).toBe(405);
  });

  test('full flow: register → order → validate → finalize → cert', async () => {
    // Register an EAB credential the operator would have bound at provisioning time.
    const hmacKey = new Uint8Array(32);
    crypto.getRandomValues(hmacKey);
    eab.register({ kid: 'eab-1', hmacKey, clientId: 'client-1' });

    // 1. Generate an account key pair for the connector.
    const accountKp = await generateKeyPair('ES256');
    const accountJwk = publicJwk(accountKp.publicJwk);
    const accountSigner = new JwkSigner(accountKp.privateJwk, 'ES256');

    // 2. newAccount with EAB.
    const eabJws = await eabJwsOver(accountJwk, hmacKey, 'eab-1');
    let nonce = await fetchNonce();
    const acctBody = { termsOfServiceAgreed: true, contact: ['mailto:ops@example.com'], externalAccountBinding: eabJws };
    const acctJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/new-account',
      payload: acctBody,
    });
    const acctRes = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: acctJws,
      }),
    );
    expect(acctRes.status).toBe(201);
    const accountUrl = acctRes.headers.get('location')!;
    const accountId = accountUrl.split('/').pop()!;

    // 3. newOrder for two identifiers.
    nonce = acctRes.headers.get('replay-nonce')!;
    const orderJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/new-order',
      kid: accountUrl,
      payload: {
        identifiers: [
          { type: 'dns', value: 'connector.example.com' },
          { type: 'dns', value: 'api.example.com' },
        ],
      },
    });
    const orderRes = await handler.handle(
      new Request('https://asr.test/acme/new-order', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: orderJws,
      }),
    );
    expect(orderRes.status).toBe(201);
    const orderJson = await orderRes.json();
    expect(orderJson.status).toBe('pending');
    const orderUrl = orderRes.headers.get('location')!;
    const orderId = orderUrl.split('/').pop()!;

    // 4. Fetch each authorization and solve the http-01 challenge.
    nonce = orderRes.headers.get('replay-nonce')!;
    for (const authzUrl of orderJson.authorizations) {
      const authzId = authzUrl.split('/').pop()!;
      const authzJws = await accountJws({
        accountSigner,
        accountJwk,
        nonce,
        url: authzUrl,
        kid: accountUrl,
        payload: '',
      });
      const authzRes = await handler.handle(
        new Request(authzUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/jose+json' },
          body: authzJws,
        }),
      );
      const authzBody = await authzRes.json();
      const httpChallenge = authzBody.challenges.find((c: { type: string }) => c.type === 'http-01');
      const keyAuth = await keyAuthorization(accountJwk, httpChallenge.token);
      http.set(authzBody.identifier.value, httpChallenge.token, keyAuth);
      const dnsChallenge = authzBody.challenges.find((c: { type: string }) => c.type === 'dns-01');
      if (dnsChallenge) {
        const dnsAuth = await keyAuthorization(accountJwk, dnsChallenge.token);
        // For dns-01 we set the sha256 of the key auth as the TXT record.
        const digest = await crypto.subtle.digest('SHA-256', toBuffer(new TextEncoder().encode(dnsAuth)));
        dns.set(authzBody.identifier.value, base64UrlEncode(new Uint8Array(digest)));
      }

      nonce = authzRes.headers.get('replay-nonce')!;
      const respondJws = await accountJws({
        accountSigner,
        accountJwk,
        nonce,
        url: `https://asr.test/acme/challenge/${authzId}/${httpChallenge.url.split('/').pop()}`,
        kid: accountUrl,
        payload: {},
      });
      const respondRes = await handler.handle(
        new Request(`https://asr.test/acme/challenge/${authzId}/${httpChallenge.url.split('/').pop()}`, {
          method: 'POST',
          headers: { 'content-type': 'application/jose+json' },
          body: respondJws,
        }),
      );
      expect(respondRes.status).toBe(200);
      const respondBody = await respondRes.json();
      expect(respondBody.status).toBe('valid');
      nonce = respondRes.headers.get('replay-nonce')!;
    }

    // 5. Finalize the order with a CSR over a fresh keypair.
    const certKp = await generateKeyPair('ES256');
    const csr = await buildCsrForIdentifiers(certKp.privateJwk, publicJwk(certKp.publicJwk), [
      'connector.example.com',
      'api.example.com',
    ]);
    const finalizeJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: `https://asr.test/acme/finalize/${orderId}`,
      kid: accountUrl,
      payload: { csr: base64UrlEncode(csr) },
    });
    const finalizeRes = await handler.handle(
      new Request(`https://asr.test/acme/finalize/${orderId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: finalizeJws,
      }),
    );
    expect(finalizeRes.status).toBe(200);
    const finalizeBody = await finalizeRes.json();
    expect(finalizeBody.status).toBe('valid');
    expect(finalizeBody.certificate).toBeDefined();
    nonce = finalizeRes.headers.get('replay-nonce')!;

    // 6. Download the certificate.
    const serial = finalizeBody.certificate.split('/').pop()!;
    const certJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: `https://asr.test/acme/cert/${serial}`,
      kid: accountUrl,
      payload: '',
    });
    const certRes = await handler.handle(
      new Request(`https://asr.test/acme/cert/${serial}`, {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: certJws,
      }),
    );
    expect(certRes.status).toBe(200);
    const pem = await certRes.text();
    expect(pem).toContain('BEGIN CERTIFICATE');
    expect(pem).toContain('END CERTIFICATE');

    // 7. Revoke the cert.
    nonce = certRes.headers.get('replay-nonce')!;
    const revokeJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/revoke-cert',
      kid: accountUrl,
      payload: { serial, reason: 4 },
    });
    const revokeRes = await handler.handle(
      new Request('https://asr.test/acme/revoke-cert', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: revokeJws,
      }),
    );
    expect(revokeRes.status).toBe(200);
    const revoked = await services.certificates.find(serial);
    expect(revoked?.revokedAt).toBeDefined();
    expect(revoked?.revocationReason).toBe('4');

    // 8. newAccount with the same key returns 200 + Location (idempotency).
    nonce = revokeRes.headers.get('replay-nonce')!;
    const againJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/new-account',
      payload: acctBody,
    });
    const againRes = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: againJws,
      }),
    );
    expect(againRes.status).toBe(200);

    void accountId;
  });

  test('rejects new-account without EAB', async () => {
    const accountKp = await generateKeyPair('ES256');
    const accountJwk = publicJwk(accountKp.publicJwk);
    const accountSigner = new JwkSigner(accountKp.privateJwk, 'ES256');
    const nonce = await fetchNonce();
    const acctJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/new-account',
      payload: { termsOfServiceAgreed: true },
    });
    const res = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: acctJws,
      }),
    );
    expect(res.status).toBe(400);
  });

  test('rejects stale nonce', async () => {
    const hmacKey = new Uint8Array(32);
    crypto.getRandomValues(hmacKey);
    eab.register({ kid: 'eab-2', hmacKey, clientId: 'client-x' });
    const accountKp = await generateKeyPair('ES256');
    const accountJwk = publicJwk(accountKp.publicJwk);
    const accountSigner = new JwkSigner(accountKp.privateJwk, 'ES256');
    const eabJws = await eabJwsOver(accountJwk, hmacKey, 'eab-2');
    const body = { termsOfServiceAgreed: true, externalAccountBinding: eabJws };
    const jws = await accountJws({
      accountSigner,
      accountJwk,
      nonce: 'not-a-real-nonce',
      url: 'https://asr.test/acme/new-account',
      payload: body,
    });
    const res = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: jws,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.type).toContain('badNonce');
  });

  test('malformed JWS body → 400', async () => {
    const res = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('missing protected → 400', async () => {
    const res = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: JSON.stringify({ payload: 'x', signature: 'y' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('invalid thumbprint on certificate endpoint returns 404', async () => {
    const hmacKey = new Uint8Array(32);
    crypto.getRandomValues(hmacKey);
    eab.register({ kid: 'eab-3', hmacKey, clientId: 'c' });
    const kp = await generateKeyPair('ES256');
    const accountJwk = publicJwk(kp.publicJwk);
    const accountSigner = new JwkSigner(kp.privateJwk, 'ES256');
    let nonce = await fetchNonce();
    const jws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/new-account',
      payload: {
        termsOfServiceAgreed: true,
        externalAccountBinding: await eabJwsOver(accountJwk, hmacKey, 'eab-3'),
      },
    });
    const acctRes = await handler.handle(
      new Request('https://asr.test/acme/new-account', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: jws,
      }),
    );
    const accountUrl = acctRes.headers.get('location')!;
    nonce = acctRes.headers.get('replay-nonce')!;
    const missingJws = await accountJws({
      accountSigner,
      accountJwk,
      nonce,
      url: 'https://asr.test/acme/cert/deadbeef',
      kid: accountUrl,
      payload: '',
    });
    const res = await handler.handle(
      new Request('https://asr.test/acme/cert/deadbeef', {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: missingJws,
      }),
    );
    expect(res.status).toBe(404);
  });
});

void base64UrlDecode;
void jwkThumbprint;
