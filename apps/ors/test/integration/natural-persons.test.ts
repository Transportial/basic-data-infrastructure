// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { createServer } from '../../src/server.ts';

async function json(s: ReturnType<typeof createServer>, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await s.fetch(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('ORS natural persons', () => {
  test('POST adds a role person; GET lists only own org', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const ctxRes = await json(s, 'POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = ctxRes.body.chain_context_id;
    const added = await json(s, 'POST', `/contexts/${id}/natural-persons`, {
      actor: 'NL.NHR.11111111',
      organisation_euid: 'NL.NHR.11111111',
      person_ref: 'driver-42',
      role: 'driver',
      valid_from: '2026-04-23T00:00:00Z',
    });
    expect(added.status).toBe(201);
    expect(typeof added.body.pseudonym).toBe('string');

    const listed = await json(s, 'GET', `/contexts/${id}/natural-persons`, undefined, {
      'x-bdi-actor-euid': 'NL.NHR.11111111',
    });
    expect(listed.status).toBe(200);
    expect(listed.body.natural_persons).toHaveLength(1);
  });

  test('rejects non-party actor', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const ctxRes = await json(s, 'POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = ctxRes.body.chain_context_id;
    const added = await json(s, 'POST', `/contexts/${id}/natural-persons`, {
      actor: 'NL.NHR.99999999',
      organisation_euid: 'NL.NHR.99999999',
      person_ref: 'driver',
      role: 'driver',
    });
    expect(added.status).toBe(403);
  });

  test('rejects duplicate pseudonym', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const ctxRes = await json(s, 'POST', '/contexts', {
      association_id: 'ctn',
      orchestrator: 'NL.NHR.11111111',
      kind: 'shipment',
    });
    const id = ctxRes.body.chain_context_id;
    const body = {
      actor: 'NL.NHR.11111111',
      organisation_euid: 'NL.NHR.11111111',
      person_ref: 'same',
      role: 'driver',
    };
    await json(s, 'POST', `/contexts/${id}/natural-persons`, body);
    const second = await json(s, 'POST', `/contexts/${id}/natural-persons`, body);
    expect(second.status).toBe(409);
  });

  test('bad inputs', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const bad = await json(s, 'POST', '/contexts/not-uuid/natural-persons', {
      actor: 'bad',
    });
    expect(bad.status).toBe(400);
    const noActor = await json(
      s,
      'GET',
      '/contexts/00000000-0000-4000-8000-000000000001/natural-persons',
    );
    expect(noActor.status).toBe(400);
  });

  test('list on missing context → 404', async () => {
    const s = createServer({ port: 0, issuer: 'https://ors' });
    const listed = await json(
      s,
      'GET',
      '/contexts/00000000-0000-4000-8000-000000000001/natural-persons',
      undefined,
      { 'x-bdi-actor-euid': 'NL.NHR.11111111' },
    );
    expect(listed.status).toBe(404);
  });
});
