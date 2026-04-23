// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { createServer } from '../../src/server.ts';

async function j(s: ReturnType<typeof createServer>, method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const res = await s.fetch(req);
  return { status: res.status, body: await res.text() };
}

describe('ORS error-path coverage', () => {
  test('DELETE orchestrator → 400 cannot-remove-orchestrator', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    const res = await s.fetch(
      new Request(`http://localhost/contexts/${created.chain_context_id}/parties/NL.NHR.11111111`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'NL.NHR.11111111' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('DELETE unknown party → 400 party-not-present', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    const res = await s.fetch(
      new Request(`http://localhost/contexts/${created.chain_context_id}/parties/NL.NHR.99999999`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'NL.NHR.11111111' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('delegation delegator-not-present', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    const r = await j(s, 'POST', `/contexts/${created.chain_context_id}/delegations`, {
      actor: 'NL.NHR.11111111',
      delegator: 'NL.NHR.99999999',
      delegate: 'NL.NHR.11111111',
      action_scope: ['x'],
    });
    expect(r.status).toBe(400);
  });

  test('subscription empty event types', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    await j(s, 'POST', `/contexts/${created.chain_context_id}/parties`, {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.22222222',
      roles: ['carrier'],
    });
    s.composition.deps.connectors.register(
      'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
      ['https://example.com/hook'],
    );
    const r = await j(s, 'POST', `/contexts/${created.chain_context_id}/subscriptions`, {
      subscriber_euid: 'NL.NHR.22222222',
      subscriber_connector_id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
      event_types: [],
      callback_url: 'https://example.com/hook',
    });
    expect(r.status).toBe(400);
  });

  test('bvod on completed context', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    const ctxId = created.chain_context_id;
    // Directly complete via composition (simulating external completion)
    const ctx = await s.composition.deps.contexts.find(ctxId);
    if (!ctx) throw new Error('setup');
    await s.composition.deps.contexts.save({ ...ctx, status: 'completed' });
    const r = await j(s, 'POST', `/contexts/${ctxId}/bvod`, {
      subject_euid: 'NL.NHR.11111111',
      subject_connector_id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
    });
    expect(r.status).toBe(400);
  });

  test('duplicate party → 409', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const created = JSON.parse(
      (await j(s, 'POST', '/contexts', {
        association_id: 'ctn',
        orchestrator: 'NL.NHR.11111111',
        kind: 'shipment',
      })).body,
    );
    const r = await j(s, 'POST', `/contexts/${created.chain_context_id}/parties`, {
      actor: 'NL.NHR.11111111',
      member_euid: 'NL.NHR.11111111',
      roles: ['x'],
    });
    expect(r.status).toBe(409);
  });
});
