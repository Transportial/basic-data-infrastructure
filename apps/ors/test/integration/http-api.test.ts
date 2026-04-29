// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect, beforeEach } from 'bun:test';
import { createServer } from '../../src/server.ts';

let s: ReturnType<typeof createServer>;

beforeEach(() => {
  s = createServer({ port: 0, issuer: 'https://ors.ctn.test' });
});

async function callJson(method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const res = await s.fetch(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('ORS HTTP', () => {
  test('health endpoints', async () => {
    expect((await callJson('GET', '/health/live')).status).toBe(200);
    expect((await callJson('GET', '/health/ready')).status).toBe(200);
  });

  test('unknown route → 404', async () => {
    expect((await callJson('GET', '/nope')).status).toBe(404);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/contexts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '!!',
    });
    const res = await s.fetch(req);
    expect(res.status).toBe(400);
  });

  test('POST /contexts missing body', async () => {
    const req = new Request('http://localhost/contexts', { method: 'POST' });
    const res = await s.fetch(req);
    expect(res.status).toBe(400);
  });

  test('POST /contexts happy path', async () => {
    const r = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
      identifiers: [{ scheme: 'bl', value: 'MSCU123' }],
    });
    expect(r.status).toBe(201);
    expect(typeof r.body.chain_context_id).toBe('string');
  });

  test('POST /contexts bad association', async () => {
    const r = await callJson('POST', '/contexts', {
      association_id: 'BAD!',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    expect(r.status).toBe(400);
  });

  test('POST /contexts bad orchestrator', async () => {
    const r = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'bogus',
      kind: 'shipment',
    });
    expect(r.status).toBe(400);
  });

  test('POST /contexts bad kind', async () => {
    const r = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'unknown',
    });
    expect(r.status).toBe(400);
  });

  test('GET /contexts/:id', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    const get = await callJson('GET', `/contexts/${id}`);
    expect(get.status).toBe(200);
    const notFound = await callJson('GET', '/contexts/00000000-0000-4000-8000-000000000099');
    expect(notFound.status).toBe(404);
    const badId = await callJson('GET', '/contexts/not-uuid');
    expect(badId.status).toBe(400);
  });

  test('parties lifecycle', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    const add = await callJson('POST', `/contexts/${id}/parties`, {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.22222222',
      roles: ['carrier'],
    });
    expect(add.status).toBe(201);
    const rm = await s.fetch(
      new Request(`http://localhost/contexts/${id}/parties/NL.NHR.22222222`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'NL.NHR.11111111' }),
      }),
    );
    expect(rm.status).toBe(200);
  });

  test('parties bad inputs', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    const bad = await callJson('POST', `/contexts/${id}/parties`, { actor: 'x', member_euid: 'y' });
    expect(bad.status).toBe(400);
    const badId = await callJson('POST', '/contexts/not-uuid/parties', {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.22222222',
      roles: [],
    });
    expect(badId.status).toBe(400);
    const missingBody = await s.fetch(
      new Request(`http://localhost/contexts/${id}/parties`, { method: 'POST' }),
    );
    expect(missingBody.status).toBe(400);
  });

  test('DELETE party bad inputs', async () => {
    const rm = await s.fetch(
      new Request('http://localhost/contexts/not-uuid/parties/NL.NHR.22222222', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'NL.NHR.11111111' }),
      }),
    );
    expect(rm.status).toBe(400);
  });

  test('delegations', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    await callJson('POST', `/contexts/${id}/parties`, {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.22222222',
      roles: ['carrier'],
    });
    const ok = await callJson('POST', `/contexts/${id}/delegations`, {
      actor: 'NL.NHR.22222222',
      delegator: 'NL.NHR.22222222',
      delegate: 'NL.NHR.11111111',
      action_scope: ['read:x'],
    });
    expect(ok.status).toBe(201);
    const bad = await callJson('POST', `/contexts/${id}/delegations`, {});
    expect(bad.status).toBe(400);
  });

  test('bvod', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    const ok = await callJson('POST', `/contexts/${id}/bvod`, {
      subject_euid: 'NL.NHR.11111111',
      subject_connector_id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
    });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.bvod).toBe('string');

    const bad = await callJson('POST', `/contexts/${id}/bvod`, {});
    expect(bad.status).toBe(400);
  });

  test('subscriptions + events', async () => {
    const created = await callJson('POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = created.body.chain_context_id;
    await callJson('POST', `/contexts/${id}/parties`, {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.22222222',
      roles: ['carrier'],
    });
    s.composition.deps.connectors.register('urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567', [
      'https://example.com/hook',
    ]);
    const sub = await callJson('POST', `/contexts/${id}/subscriptions`, {
      subscriber_euid: 'NL.NHR.22222222',
      subscriber_connector_id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
      event_types: ['eta_updated'],
      callback_url: 'https://example.com/hook',
    });
    expect(sub.status).toBe(201);
    const badSub = await callJson('POST', `/contexts/${id}/subscriptions`, {});
    expect(badSub.status).toBe(400);

    const pub = await callJson('POST', `/contexts/${id}/events`, {
      publisher: 'NL.NHR.11111111',
      event_type: 'eta_updated',
      payload: { eta: 'x' },
    });
    expect(pub.status).toBe(200);
    expect(pub.body.deliveries).toHaveLength(1);

    const noType = await callJson('POST', `/contexts/${id}/events`, {
      publisher: 'NL.NHR.11111111',
    });
    expect(noType.status).toBe(400);

    const badPub = await callJson('POST', `/contexts/${id}/events`, { publisher: 'x' });
    expect(badPub.status).toBe(400);
  });
});
