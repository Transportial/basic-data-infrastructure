// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { base64UrlEncode, type Jwk } from '@transportial/kernel';
import { verifyClientAssertion } from '../src/client-assertion.ts';
import { generateKeyPair, JwkSigner, publicJwk } from '../src/keygen.ts';

async function makeAssertion(opts: {
  iss: string;
  sub: string;
  aud: string | string[];
  iat: number;
  exp: number;
  jti?: string;
  alg?: 'ES256' | 'EdDSA';
  sign: (bytes: Uint8Array) => Promise<Uint8Array>;
}): Promise<string> {
  const header = { alg: opts.alg ?? 'ES256', typ: 'JWT' };
  const payload = {
    iss: opts.iss,
    sub: opts.sub,
    aud: opts.aud,
    iat: opts.iat,
    exp: opts.exp,
    jti: opts.jti ?? 'jti-1',
  };
  const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const p = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await opts.sign(new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

describe('verifyClientAssertion', () => {
  test('happy path ES256', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'client-1',
      sub: 'client-1',
      aud: 'https://asr/oauth2/token',
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'https://asr/oauth2/token',
      now,
    });
    expect(r.ok).toBe(true);
  });

  test('malformed → malformed', async () => {
    const r = await verifyClientAssertion('only.two', {} as Jwk, {
      clientId: 'x',
      expectedAudience: 'y',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('malformed');
  });

  test('header-invalid', async () => {
    const r = await verifyClientAssertion('!!!.!!!.!!!', {} as Jwk, {
      clientId: 'x',
      expectedAudience: 'y',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('header-invalid');
  });

  test('payload-invalid', async () => {
    const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })));
    const p = base64UrlEncode(new TextEncoder().encode('not-json'));
    const r = await verifyClientAssertion(`${h}.${p}.AAAA`, {} as Jwk, {
      clientId: 'x',
      expectedAudience: 'y',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('payload-invalid');
  });

  test('unsupported alg', async () => {
    const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256' })));
    const p = base64UrlEncode(new TextEncoder().encode(JSON.stringify({})));
    const r = await verifyClientAssertion(`${h}.${p}.AAAA`, {} as Jwk, {
      clientId: 'x',
      expectedAudience: 'y',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('unsupported-alg');
  });

  test('missing alg', async () => {
    const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify({})));
    const p = base64UrlEncode(new TextEncoder().encode(JSON.stringify({})));
    const r = await verifyClientAssertion(`${h}.${p}.AAAA`, {} as Jwk, {
      clientId: 'x',
      expectedAudience: 'y',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('unsupported-alg');
  });

  test('wrong iss', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'other',
      sub: 'client-1',
      aud: 'aud',
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'aud',
      now,
    });
    expect(!r.ok && r.error.type).toBe('wrong-issuer');
  });

  test('wrong sub', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'client-1',
      sub: 'other',
      aud: 'aud',
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'aud',
      now,
    });
    expect(!r.ok && r.error.type).toBe('wrong-subject');
  });

  test('wrong aud (string)', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'client-1',
      sub: 'client-1',
      aud: 'other',
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'aud',
      now,
    });
    expect(!r.ok && r.error.type).toBe('wrong-audience');
  });

  test('aud array ok', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'client-1',
      sub: 'client-1',
      aud: ['a', 'aud', 'b'],
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'aud',
      now,
    });
    expect(r.ok).toBe(true);
  });

  test('aud array miss', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'client-1',
      sub: 'client-1',
      aud: ['a', 'b'],
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'client-1',
      expectedAudience: 'aud',
      now,
    });
    expect(!r.ok && r.error.type).toBe('wrong-audience');
  });

  test('expired', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const jwt = await makeAssertion({
      iss: 'c',
      sub: 'c',
      aud: 'a',
      iat: 100,
      exp: 200,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'c',
      expectedAudience: 'a',
      now: 9_999,
    });
    expect(!r.ok && r.error.type).toBe('expired');
  });

  test('not yet valid', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const jwt = await makeAssertion({
      iss: 'c',
      sub: 'c',
      aud: 'a',
      iat: 10_000,
      exp: 20_000,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'c',
      expectedAudience: 'a',
      now: 0,
    });
    expect(!r.ok && r.error.type).toBe('not-yet-valid');
  });

  test('missing jti', async () => {
    const kp = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp.privateJwk, 'ES256');
    const now = 1_000;
    const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })));
    const p = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({ iss: 'c', sub: 'c', aud: 'a', iat: now - 5, exp: now + 60 }),
      ),
    );
    const sig = await signer.sign(new TextEncoder().encode(`${h}.${p}`));
    const jwt = `${h}.${p}.${base64UrlEncode(sig)}`;
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'c',
      expectedAudience: 'a',
      now,
    });
    expect(!r.ok && r.error.type).toBe('missing-jti');
  });

  test('bad signature', async () => {
    const kp1 = await generateKeyPair('ES256');
    const kp2 = await generateKeyPair('ES256');
    const signer = new JwkSigner(kp1.privateJwk, 'ES256');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'c',
      sub: 'c',
      aud: 'a',
      iat: now - 10,
      exp: now + 600,
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp2.privateJwk), {
      clientId: 'c',
      expectedAudience: 'a',
      now,
    });
    expect(!r.ok && r.error.type).toBe('bad-signature');
  });

  test('EdDSA works too', async () => {
    const kp = await generateKeyPair('EdDSA');
    const signer = new JwkSigner(kp.privateJwk, 'EdDSA');
    const now = 1_000_000;
    const jwt = await makeAssertion({
      iss: 'c',
      sub: 'c',
      aud: 'a',
      iat: now - 10,
      exp: now + 600,
      alg: 'EdDSA',
      sign: (b) => signer.sign(b),
    });
    const r = await verifyClientAssertion(jwt, publicJwk(kp.privateJwk), {
      clientId: 'c',
      expectedAudience: 'a',
      now,
    });
    expect(r.ok).toBe(true);
  });
});
