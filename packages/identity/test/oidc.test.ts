// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { base64UrlEncode } from '@bdi/kernel';
import { JwkSigner, generateKeyPair, publicJwk } from '@bdi/crypto';
import { OidcAccessTokenVerifier } from '../src/oidc.ts';

type FetcherResponses = Record<string, unknown>;

function makeFetcher(responses: FetcherResponses): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = responses[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function mintJwt(
  privateJwk: Record<string, unknown>,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const alg = header.alg as 'ES256' | 'ES384' | 'EdDSA' | 'PS256';
  const signer = new JwkSigner(privateJwk as never, alg);
  const h = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const p = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const sig = await signer.sign(signingInput);
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

describe('OidcAccessTokenVerifier', () => {
  const issuer = 'https://id.example/realms/bdi';
  const jwksUri = 'https://id.example/realms/bdi/jwks';
  const discovery = {
    issuer,
    jwks_uri: jwksUri,
  };

  test('verifies a valid ES256 token and extracts roles, name, email', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: 'asr-admin',
        sub: 'alice',
        name: 'Alice Admin',
        email: 'alice@example.org',
        realm_access: { roles: ['asr-admin', 'operator'] },
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subject).toBe('alice');
      expect(r.value.name).toBe('Alice Admin');
      expect(r.value.email).toBe('alice@example.org');
      expect(r.value.roles).toEqual(['asr-admin', 'operator']);
      expect(r.value.idp).toBe(issuer);
    }
  });

  test('rejects token with wrong issuer', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: 'https://evil.example',
        aud: 'asr-admin',
        sub: 'alice',
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('wrong-issuer');
  });

  test('rejects token with wrong audience', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: 'other-service',
        sub: 'alice',
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('wrong-audience');
  });

  test('rejects expired token', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
      clockSkewSeconds: 0,
    });
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: 'asr-admin',
        sub: 'alice',
        iat: past - 60,
        exp: past,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('expired');
  });

  test('rejects malformed token (not three parts)', async () => {
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher: makeFetcher({}),
    });
    const r = await verifier.authenticate('not.a.jwt.at.all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('malformed-token');
  });

  test('missing-token on empty bearer', async () => {
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher: makeFetcher({}),
    });
    const r = await verifier.authenticate('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('missing-token');
  });

  test('bad-signature when signed by unknown key', async () => {
    const pair = await generateKeyPair('ES256');
    const other = await generateKeyPair('ES256');
    // JWKS only contains "pair" but token was minted with "other".
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      other.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: 'asr-admin',
        sub: 'mallory',
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('bad-signature');
  });

  test('audience list matches any of expected', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: ['asr-admin', 'ors-admin'],
      fetcher,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: ['unrelated', 'ors-admin'],
        sub: 'alice',
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(true);
  });

  test('acr maps to assurance via acrToAssurance', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    const fetcher = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
      acrToAssurance: (acr) =>
        acr.includes('LoA3') ? 'substantial' : acr.includes('LoA4') ? 'high' : undefined,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      {
        iss: issuer,
        aud: 'asr-admin',
        sub: 'alice',
        acr: 'urn:etoegang:LoA3',
        iat: now,
        exp: now + 300,
      },
    );
    const r = await verifier.authenticate(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assurance).toBe('substantial');
  });

  test('jwks cache reused within ttl', async () => {
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    let fetchCount = 0;
    const inner = makeFetcher({
      [`${issuer}/.well-known/openid-configuration`]: discovery,
      [jwksUri]: { keys: [pub] },
    });
    const fetcher = (async (...args: Parameters<typeof fetch>) => {
      fetchCount++;
      return inner(...args);
    }) as typeof fetch;
    const verifier = new OidcAccessTokenVerifier({
      expectedIssuer: issuer,
      expectedAudience: 'asr-admin',
      fetcher,
      jwksCacheTtlMs: 60_000,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await mintJwt(
      pair.privateJwk as never,
      { alg: 'ES256', kid: pair.kid, typ: 'JWT' },
      { iss: issuer, aud: 'asr-admin', sub: 'alice', iat: now, exp: now + 300 },
    );
    await verifier.authenticate(token);
    await verifier.authenticate(token);
    // 2 fetches on first call (discovery + jwks), 0 on second.
    expect(fetchCount).toBe(2);
  });
});
