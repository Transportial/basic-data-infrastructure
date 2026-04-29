// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect, beforeEach } from 'bun:test';
import { base64UrlEncode } from '@transportial/kernel';
import { generateKeyPair, JwkSigner, publicJwk } from '@transportial/crypto';
import { createServer } from '../../src/server.ts';
import { AlwaysSuccessSource } from '../fixtures/fake-sources.ts';

async function makeClientAssertion(opts: {
  privateJwk: Parameters<typeof JwkSigner>[0];
  clientId: string;
  audience: string;
}) {
  const signer = new JwkSigner(opts.privateJwk, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })),
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: opts.clientId,
        sub: opts.clientId,
        aud: opts.audience,
        iat: now - 5,
        exp: now + 600,
        jti: crypto.randomUUID(),
      }),
    ),
  );
  const sig = await signer.sign(new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

async function json(server: Awaited<ReturnType<typeof createServer>>, method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const res = await server.fetch(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text, headers: res.headers };
}

async function form(server: Awaited<ReturnType<typeof createServer>>, path: string, fields: Record<string, string>) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const res = await server.fetch(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let server: Awaited<ReturnType<typeof createServer>>;

beforeEach(async () => {
  server = await createServer({ port: 0, issuer: 'https://asr.ctn.test' });
});

describe('ASR HTTP API', () => {
  test('GET /health/live', async () => {
    const r = await json(server, 'GET', '/health/live');
    expect(r.status).toBe(200);
  });

  test('GET /health/ready', async () => {
    const r = await json(server, 'GET', '/health/ready');
    expect(r.status).toBe(200);
  });

  test('POST /admin/members creates draft', async () => {
    const r = await json(server, 'POST', '/admin/members', {
      euid: 'NL.NHR.12345678',
      association_id: 'ctn',
      legal_name: 'Acme BV',
      signing_representative: {
        subject_id: 's',
        auth_source: 'eHerkenning',
        assurance: 'high',
        verified_at: '2026-04-01T00:00:00Z',
      },
    });
    expect(r.status).toBe(201);
    expect(typeof r.body.member_id).toBe('string');
  });

  test('POST /admin/members rejects missing body', async () => {
    const req = new Request('http://localhost/admin/members', { method: 'POST' });
    const res = await server.fetch(req);
    expect(res.status).toBe(400);
  });

  test('POST /admin/members rejects bad euid', async () => {
    const r = await json(server, 'POST', '/admin/members', {
      euid: 'XX-NO',
      association_id: 'ctn',
      legal_name: 'Acme',
    });
    expect(r.status).toBe(400);
  });

  test('POST /admin/members rejects bad association', async () => {
    const r = await json(server, 'POST', '/admin/members', {
      euid: 'NL.NHR.12345678',
      association_id: 'BAD!',
      legal_name: 'Acme',
    });
    expect(r.status).toBe(400);
  });

  test('POST /admin/members rejects missing legal name', async () => {
    const r = await json(server, 'POST', '/admin/members', {
      euid: 'NL.NHR.12345678',
      association_id: 'ctn',
    });
    expect(r.status).toBe(400);
  });

  test('duplicate registration → 409', async () => {
    const body = {
      euid: 'NL.NHR.12345678',
      association_id: 'ctn',
      legal_name: 'Acme',
    };
    const first = await json(server, 'POST', '/admin/members', body);
    expect(first.status).toBe(201);
    const second = await json(server, 'POST', '/admin/members', body);
    expect(second.status).toBe(409);
  });

  test('approval flow (needs verifications done)', async () => {
    // Stub: install a successful verification source by using RunVerifications directly
    const s = await createServer({
      port: 0,
      issuer: 'https://asr.ctn.test',
      verificationSources: [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
    });
    const create = await (async () => {
      const r = new Request('http://localhost/admin/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          euid: 'NL.NHR.12345678',
          association_id: 'ctn',
          legal_name: 'Acme',
          signing_representative: {
            subject_id: 's',
            auth_source: 'eHerkenning',
            assurance: 'high',
            verified_at: '2026-04-01T00:00:00Z',
          },
        }),
      });
      return JSON.parse(await (await s.fetch(r)).text());
    })();
    const id = create.member_id as string;

    // Run verifications
    const verRes = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/run-verifications`, { method: 'POST' }),
    );
    expect(verRes.status).toBe(202);

    // Approver 1
    const a1 = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'alice' }),
      }),
    );
    const a1Body = JSON.parse(await a1.text());
    expect(a1Body.state).toBe('awaiting-second-approval');

    // Approver 2 — same person is forbidden
    const again = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'alice' }),
      }),
    );
    expect(again.status).toBe(403);

    // Different approver → activated
    const a2 = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'bob' }),
      }),
    );
    const a2Body = JSON.parse(await a2.text());
    expect(a2Body.state).toBe('activated');

    // suspend/reinstate/revoke
    const sus = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/suspend`, { method: 'POST' }),
    );
    expect(sus.status).toBe(200);
    const rei = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/reinstate`, { method: 'POST' }),
    );
    expect(rei.status).toBe(200);
    const rev = await s.fetch(
      new Request(`http://localhost/admin/members/${id}/revoke`, { method: 'POST' }),
    );
    expect(rev.status).toBe(200);
  });

  test('run-verifications on missing member → 404', async () => {
    const r = await json(server, 'POST', '/admin/members/missing/run-verifications');
    expect(r.status).toBe(404);
  });

  test('approve without approver → 400', async () => {
    const r = await json(server, 'POST', '/admin/members/any/approve', {});
    expect(r.status).toBe(400);
  });

  test('POST /admin/connectors happy path', async () => {
    const s = await createServer({
      port: 0,
      issuer: 'https://asr.ctn.test',
      verificationSources: [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
    });
    const create = JSON.parse(
      await (
        await s.fetch(
          new Request('http://localhost/admin/members', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              euid: 'NL.NHR.12345678',
              association_id: 'ctn',
              legal_name: 'Acme',
              signing_representative: {
                subject_id: 's',
                auth_source: 'eHerkenning',
                assurance: 'high',
                verified_at: '2026-04-01T00:00:00Z',
              },
            }),
          }),
        )
      ).text(),
    );
    const id = create.member_id as string;
    await s.fetch(new Request(`http://localhost/admin/members/${id}/run-verifications`, { method: 'POST' }));
    await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'alice' }),
      }),
    );
    await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'bob' }),
      }),
    );

    const conRes = await s.fetch(
      new Request('http://localhost/admin/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          member_id: id,
          client_id: 'client-1',
          jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
          kid: 'k',
          cert_thumbprint: 'tp',
          cert_not_after: 9_999_999_999,
          callback_urls: ['https://example.com/hook'],
          authorised_by: 'rep',
        }),
      }),
    );
    expect(conRes.status).toBe(201);
  });

  test('POST /admin/connectors rejects bad body', async () => {
    const r = await json(server, 'POST', '/admin/connectors', { member_id: 'x' });
    expect(r.status).toBe(400);
  });

  test('POST /oauth2/token unknown client → 401', async () => {
    const r = await form(server, '/oauth2/token', {
      grant_type: 'client_credentials',
      client_id: 'missing',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'aaa.bbb.ccc',
    });
    expect(r.status).toBe(401);
  });

  test('POST /oauth2/token invalid request → 400', async () => {
    const r = await form(server, '/oauth2/token', { grant_type: 'bad' });
    expect(r.status).toBe(400);
  });

  test('GET trustlist', async () => {
    const res = await server.fetch(
      new Request('http://localhost/.well-known/bdi/trustlist/ctn', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/jose');
  });

  test('GET trustlist bad association', async () => {
    const res = await server.fetch(
      new Request('http://localhost/.well-known/bdi/trustlist/BAD!', { method: 'GET' }),
    );
    expect(res.status).toBe(400);
  });

  test('POST with invalid JSON → 400', async () => {
    const req = new Request('http://localhost/admin/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await server.fetch(req);
    expect(res.status).toBe(400);
  });

  test('unknown route → 404', async () => {
    const r = await json(server, 'GET', '/nope');
    expect(r.status).toBe(404);
  });
});

describe('issue BVAD end-to-end', () => {
  test('full flow: member activated → connector active → BVAD issued', async () => {
    const s = await createServer({
      port: 0,
      issuer: 'https://asr.ctn.test',
      verificationSources: [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
    });
    const keyPair = await generateKeyPair('ES256');
    const clientPublicJwk = publicJwk(keyPair.publicJwk);
    const create = JSON.parse(
      await (
        await s.fetch(
          new Request('http://localhost/admin/members', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              euid: 'NL.NHR.12345678',
              association_id: 'ctn',
              legal_name: 'Acme',
              signing_representative: {
                subject_id: 's',
                auth_source: 'eHerkenning',
                assurance: 'high',
                verified_at: '2026-04-01T00:00:00Z',
              },
            }),
          }),
        )
      ).text(),
    );
    const id = create.member_id as string;
    await s.fetch(new Request(`http://localhost/admin/members/${id}/run-verifications`, { method: 'POST' }));
    await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'alice' }),
      }),
    );
    await s.fetch(
      new Request(`http://localhost/admin/members/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approver: 'bob' }),
      }),
    );
    const conJson = JSON.parse(
      await (
        await s.fetch(
          new Request('http://localhost/admin/connectors', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              member_id: id,
              client_id: 'client-1',
              jwk: clientPublicJwk,
              kid: keyPair.kid,
              cert_thumbprint: 'tp',
              cert_not_after: 9_999_999_999,
              callback_urls: ['https://example.com/hook'],
              authorised_by: 'rep',
            }),
          }),
        )
      ).text(),
    );
    // Promote connector to active using the composition directly for the test
    const con = await s.composition.deps.connectors.find(conJson.connector_id);
    if (!con) throw new Error('setup');
    await s.composition.deps.connectors.save({ ...con, status: 'active' });

    const assertion = await makeClientAssertion({
      privateJwk: keyPair.privateJwk,
      clientId: 'client-1',
      audience: 'https://asr.ctn.test/oauth2/token',
    });

    const tokenRes = await s.fetch(
      new Request('http://localhost/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'client-1',
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion,
          audience: 'urn:bdi:association:ctn',
        }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(200);
    const payload = JSON.parse(await tokenRes.text());
    expect(payload.token_type).toBe('Bearer');
    expect(typeof payload.access_token).toBe('string');
    expect(payload.access_token.split('.')).toHaveLength(3);
  });
});
