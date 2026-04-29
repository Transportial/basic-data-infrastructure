// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { generateKeyPair, publicJwk } from '@transportial/crypto';
import {
  buildClientAssertion,
  createHarness,
  onboardActiveMember,
  registerConnector,
  type BdiHarness,
} from '../src/index.ts';

let harness: BdiHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.stop();
});

describe('ASR — health and observability', () => {
  test('GET /health/live → 200', async () => {
    const r = await harness.asr.get('/health/live');
    expect(r.status).toBe(200);
  });

  test('GET /health/ready → 200', async () => {
    const r = await harness.asr.get('/health/ready');
    expect(r.status).toBe(200);
  });

  test('GET /health/startup → 200', async () => {
    const r = await harness.asr.get('/health/startup');
    expect(r.status).toBe(200);
  });

  test('GET /metrics → 200 with Prometheus content-type', async () => {
    const r = await harness.asr.get('/metrics');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });
});

describe('ASR — POST /admin/members', () => {
  test('happy path returns 201 with member_id', async () => {
    const r = await harness.asr.post<{ member_id: string }>('/admin/members', {
      euid: 'NL.NHR.20000001',
      association_id: harness.associationId,
      legal_name: 'Acme BV',
    });
    expect(r.status).toBe(201);
    expect(typeof r.body.member_id).toBe('string');
  });

  test('missing body → 400', async () => {
    const res = await harness.asr.fetch(
      new Request(harness.asr.url('/admin/members'), { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  test('bad euid → 400', async () => {
    const r = await harness.asr.post('/admin/members', {
      euid: 'not-a-euid',
      association_id: harness.associationId,
      legal_name: 'Acme',
    });
    expect(r.status).toBe(400);
  });

  test('bad association → 400', async () => {
    const r = await harness.asr.post('/admin/members', {
      euid: 'NL.NHR.20000001',
      association_id: 'BAD!',
      legal_name: 'Acme',
    });
    expect(r.status).toBe(400);
  });

  test('missing legal_name → 400', async () => {
    const r = await harness.asr.post('/admin/members', {
      euid: 'NL.NHR.20000001',
      association_id: harness.associationId,
    });
    expect(r.status).toBe(400);
  });

  test('duplicate registration → 409', async () => {
    const body = {
      euid: 'NL.NHR.20000001',
      association_id: harness.associationId,
      legal_name: 'Acme',
    };
    expect((await harness.asr.post('/admin/members', body)).status).toBe(201);
    expect((await harness.asr.post('/admin/members', body)).status).toBe(409);
  });
});

describe('ASR — member lifecycle', () => {
  test('run-verifications on missing member → 404', async () => {
    const r = await harness.asr.post('/admin/members/nonexistent/run-verifications');
    expect(r.status).toBe(404);
  });

  test('approve without approver → 400', async () => {
    const r = await harness.asr.post('/admin/members/any/approve', {});
    expect(r.status).toBe(400);
  });

  test('same approver twice → 403', async () => {
    const created = await harness.asr.post<{ member_id: string }>('/admin/members', {
      euid: 'NL.NHR.20000010',
      association_id: harness.associationId,
      legal_name: 'Dup Approver',
      signing_representative: {
        subject_id: 'rep',
        auth_source: 'eHerkenning',
        assurance: 'high',
        verified_at: '2026-04-01T00:00:00Z',
      },
    });
    await harness.asr.post(`/admin/members/${created.body.member_id}/run-verifications`);
    const a1 = await harness.asr.post(`/admin/members/${created.body.member_id}/approve`, {
      approver: 'alice',
    });
    expect(a1.status).toBe(200);
    const a2 = await harness.asr.post(`/admin/members/${created.body.member_id}/approve`, {
      approver: 'alice',
    });
    expect(a2.status).toBe(403);
  });

  test('suspend → reinstate → revoke each return 200', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.20000020',
      legalName: 'Lifecycle BV',
    });

    const sus = await harness.asr.post(`/admin/members/${memberId}/suspend`);
    expect(sus.status).toBe(200);
    const rei = await harness.asr.post(`/admin/members/${memberId}/reinstate`);
    expect(rei.status).toBe(200);
    const rev = await harness.asr.post(`/admin/members/${memberId}/revoke`);
    expect(rev.status).toBe(200);
  });

  test('suspend on missing member → 404', async () => {
    const r = await harness.asr.post('/admin/members/missing/suspend');
    expect(r.status).toBe(404);
  });
});

describe('ASR — POST /admin/connectors', () => {
  test('happy path → 201', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.20000030',
      legalName: 'Connector BV',
    });
    const { connectorId } = await registerConnector(harness, {
      memberId,
      clientId: 'connector-happy-path',
    });
    expect(connectorId).toBeTruthy();
  });

  test('missing fields → 400', async () => {
    const r = await harness.asr.post('/admin/connectors', { member_id: 'x' });
    expect(r.status).toBe(400);
  });
});

describe('ASR — /oauth2/token', () => {
  test('client_credentials with unknown client → 401', async () => {
    const r = await harness.asr.form('/oauth2/token', {
      grant_type: 'client_credentials',
      client_id: 'unknown',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'aaa.bbb.ccc',
    });
    expect(r.status).toBe(401);
  });

  test('client_credentials happy path returns BVAD', async () => {
    // Onboard + register a connector with a real ES256 keypair so the
    // client_assertion verifies cryptographically.
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.20000040',
      legalName: 'Token BV',
    });
    const keypair = await generateKeyPair('ES256');
    const clientId = 'token-client-1';
    await registerConnector(harness, {
      memberId,
      clientId,
      jwk: publicJwk(keypair.publicJwk) as unknown as Readonly<Record<string, unknown>>,
      kid: keypair.kid,
    });
    const tokenEndpoint = `${harness.issuers.asr}/oauth2/token`;
    const assertion = await buildClientAssertion({
      clientId,
      audience: tokenEndpoint,
      privateJwk: keypair.privateJwk,
    });

    const r = await harness.asr.form<{ access_token: string; token_type: string }>(
      '/oauth2/token',
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        audience: harness.audience,
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe('Bearer');
    expect(r.body.access_token.split('.')).toHaveLength(3);
  });

  test('token-exchange with unknown subject token → 400', async () => {
    const r = await harness.asr.form('/oauth2/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'malformed',
      audience: 'urn:bdi:asr:peer',
    });
    expect(r.status).toBe(400);
  });
});

describe('ASR — discovery and trust endpoints', () => {
  test('GET /.well-known/jwks.json → 200 with at least one key', async () => {
    const r = await harness.asr.get<{ keys: ReadonlyArray<unknown> }>(
      '/.well-known/jwks.json',
    );
    expect(r.status).toBe(200);
    expect(r.body.keys.length).toBeGreaterThan(0);
  });

  test('GET /.well-known/oauth-authorization-server → 200 with metadata', async () => {
    const r = await harness.asr.get<{
      issuer: string;
      token_endpoint: string;
      jwks_uri: string;
    }>('/.well-known/oauth-authorization-server');
    expect(r.status).toBe(200);
    expect(r.body.token_endpoint).toContain('/oauth2/token');
    expect(r.body.jwks_uri).toContain('/.well-known/jwks.json');
  });

  test('GET /.well-known/bdi/trustlist/:association → 200 application/jose', async () => {
    const r = await harness.asr.get(
      `/.well-known/bdi/trustlist/${harness.associationId}`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/jose');
  });

  test('GET /.well-known/bdi/trustlist/:association with bad association → 400', async () => {
    const r = await harness.asr.get('/.well-known/bdi/trustlist/BAD!');
    expect(r.status).toBe(400);
  });

  test('GET /.well-known/bdi/members/:euid for active member → 200', async () => {
    await onboardActiveMember(harness, {
      euid: 'NL.NHR.20000050',
      legalName: 'Descriptor BV',
    });
    const r = await harness.asr.get('/.well-known/bdi/members/NL.NHR.20000050');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/jose');
  });

  test('GET /.well-known/bdi/members/:euid bad euid → 400', async () => {
    const r = await harness.asr.get('/.well-known/bdi/members/not-a-euid');
    expect(r.status).toBe(400);
  });

  test('GET /.well-known/bdi/members/:euid missing → 404', async () => {
    const r = await harness.asr.get('/.well-known/bdi/members/NL.NHR.99999998');
    expect(r.status).toBe(404);
  });
});

describe('ASR — ACME', () => {
  test('GET /acme/directory → 200', async () => {
    const r = await harness.asr.get('/acme/directory');
    expect(r.status).toBe(200);
  });

  test('POST /acme/ocsp with malformed body → 400', async () => {
    const res = await harness.asr.fetch(
      new Request(harness.asr.url('/acme/ocsp'), {
        method: 'POST',
        headers: { 'content-type': 'application/ocsp-request' },
        body: new Uint8Array([0x00, 0x01]),
      }),
    );
    expect(res.status).toBe(400);
  });
});
