// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  addParty,
  createChainContext,
  createHarness,
  publishContextEvent,
  type BdiHarness,
} from '../src/index.ts';

let harness: BdiHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.stop();
});

describe('ORS — health and observability', () => {
  test('GET /health/live → 200', async () => {
    expect((await harness.ors.get('/health/live')).status).toBe(200);
  });
  test('GET /health/ready → 200', async () => {
    expect((await harness.ors.get('/health/ready')).status).toBe(200);
  });
  test('GET /health/startup → 200', async () => {
    expect((await harness.ors.get('/health/startup')).status).toBe(200);
  });
  test('GET /metrics → 200', async () => {
    const r = await harness.ors.get('/metrics');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });
  test('unknown route → 404', async () => {
    expect((await harness.ors.get('/nope')).status).toBe(404);
  });
});

describe('ORS — POST /contexts', () => {
  test('happy path returns 201 with chain_context_id', async () => {
    const r = await harness.ors.post<{ chain_context_id: string }>('/contexts', {
      association_id: harness.associationId,
      orchestrator: 'NL.NHR.30000001',
      kind: 'shipment',
      identifiers: [{ scheme: 'bl', value: 'MSCU-1' }],
    });
    expect(r.status).toBe(201);
    expect(typeof r.body.chain_context_id).toBe('string');
  });

  test('missing body → 400', async () => {
    const res = await harness.ors.fetch(
      new Request(harness.ors.url('/contexts'), { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const res = await harness.ors.fetch(
      new Request(harness.ors.url('/contexts'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '!!',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('bad association → 400', async () => {
    const r = await harness.ors.post('/contexts', {
      association_id: 'BAD!',
      orchestrator: 'NL.NHR.30000001',
      kind: 'shipment',
    });
    expect(r.status).toBe(400);
  });

  test('bad orchestrator → 400', async () => {
    const r = await harness.ors.post('/contexts', {
      association_id: harness.associationId,
      orchestrator: 'bogus',
      kind: 'shipment',
    });
    expect(r.status).toBe(400);
  });

  test('bad kind → 400', async () => {
    const r = await harness.ors.post('/contexts', {
      association_id: harness.associationId,
      orchestrator: 'NL.NHR.30000001',
      kind: 'unknown',
    });
    expect(r.status).toBe(400);
  });
});

describe('ORS — GET /contexts/:id', () => {
  test('existing context → 200', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000010' });
    const r = await harness.ors.get(`/contexts/${ctx.chainContextId}`);
    expect(r.status).toBe(200);
  });

  test('bad id format → 400', async () => {
    const r = await harness.ors.get('/contexts/not-a-uuid');
    expect(r.status).toBe(400);
  });

  test('valid uuid that does not exist → 404', async () => {
    const r = await harness.ors.get('/contexts/00000000-0000-4000-8000-000000000099');
    expect(r.status).toBe(404);
  });
});

describe('ORS — parties', () => {
  test('POST + DELETE round-trip succeeds', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000020' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000020',
      memberEuid: 'NL.NHR.30000021',
      roles: ['carrier'],
    });
    const del = await harness.ors.delete(
      `/contexts/${ctx.chainContextId}/parties/NL.NHR.30000021`,
      { actor: 'NL.NHR.30000020' },
    );
    expect(del.status).toBe(200);
  });

  test('POST /contexts/:id/parties bad euid → 400', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000022' });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/parties`, {
      actor: 'bogus',
      member_euid: 'also-bogus',
      roles: ['carrier'],
    });
    expect(r.status).toBe(400);
  });

  test('DELETE party with bad input → 400', async () => {
    const r = await harness.ors.delete('/contexts/not-uuid/parties/NL.NHR.1', {
      actor: 'NL.NHR.30000020',
    });
    expect(r.status).toBe(400);
  });
});

describe('ORS — POST /contexts/:id/delegations', () => {
  test('happy path', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000030' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000030',
      memberEuid: 'NL.NHR.30000031',
      roles: ['carrier'],
    });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000030',
      memberEuid: 'NL.NHR.30000032',
      roles: ['sub-carrier'],
    });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/delegations`, {
      actor: 'NL.NHR.30000031',
      delegator: 'NL.NHR.30000031',
      delegate: 'NL.NHR.30000032',
      action_scope: ['read:eta'],
      valid_until: null,
    });
    expect(r.status).toBe(201);
  });

  test('bad input → 400', async () => {
    const r = await harness.ors.post('/contexts/not-uuid/delegations', {
      actor: 'bogus',
      delegator: 'bogus',
      delegate: 'bogus',
    });
    expect(r.status).toBe(400);
  });
});

describe('ORS — POST /contexts/:id/bvod', () => {
  test('happy path returns BVOD', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000040' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000040',
      memberEuid: 'NL.NHR.30000041',
      roles: ['carrier'],
    });
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const r = await harness.ors.post<{ bvod: string }>(
      `/contexts/${ctx.chainContextId}/bvod`,
      {
        subject_euid: 'NL.NHR.30000041',
        subject_connector_id: peerConnector,
        audience: peerConnector,
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.bvod.split('.')).toHaveLength(3);
  });

  test('bad input → 400', async () => {
    const r = await harness.ors.post('/contexts/not-uuid/bvod', {
      subject_euid: 'NL.NHR.1',
      subject_connector_id: 'bogus',
    });
    expect(r.status).toBe(400);
  });
});

describe('ORS — POST /contexts/:id/subscriptions', () => {
  test('happy path returns subscription_id', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000050' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000050',
      memberEuid: 'NL.NHR.30000051',
      roles: ['carrier'],
    });
    const subConnectorId = `urn:bdi:connector:${crypto.randomUUID()}`;
    const callback = 'https://sub.example/hook';
    // ORS holds an in-memory cache of connector → allowed callback URLs that
    // is normally populated from ASR events. Seed it directly so the
    // subscription validator accepts our callback URL.
    harness.composition.ors.deps.connectors.register(subConnectorId, [callback]);
    const r = await harness.ors.post<{ subscription_id: string }>(
      `/contexts/${ctx.chainContextId}/subscriptions`,
      {
        subscriber_euid: 'NL.NHR.30000051',
        subscriber_connector_id: subConnectorId,
        event_types: ['order.created'],
        callback_url: callback,
      },
    );
    expect(r.status).toBe(201);
    expect(typeof r.body.subscription_id).toBe('string');
  });

  test('bad input → 400', async () => {
    const r = await harness.ors.post('/contexts/not-uuid/subscriptions', {
      subscriber_euid: 'NL.NHR.1',
      subscriber_connector_id: 'bogus',
      event_types: ['x'],
      callback_url: 'https://x',
    });
    expect(r.status).toBe(400);
  });
});

describe('ORS — natural persons', () => {
  test('POST + GET round-trip', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000060' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.30000060',
      memberEuid: 'NL.NHR.30000061',
      roles: ['carrier'],
    });
    const post = await harness.ors.post<{ pseudonym: string }>(
      `/contexts/${ctx.chainContextId}/natural-persons`,
      {
        actor: 'NL.NHR.30000060',
        organisation_euid: 'NL.NHR.30000060',
        person_ref: 'employee-42',
        role: 'driver',
      },
    );
    expect(post.status).toBe(201);
    expect(typeof post.body.pseudonym).toBe('string');

    const list = await harness.ors.get<{ natural_persons: ReadonlyArray<unknown> }>(
      `/contexts/${ctx.chainContextId}/natural-persons`,
      { 'x-bdi-actor-euid': 'NL.NHR.30000060' },
    );
    expect(list.status).toBe(200);
    expect(list.body.natural_persons.length).toBeGreaterThan(0);
  });

  test('POST natural-persons missing role → 400', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000070' });
    const r = await harness.ors.post(
      `/contexts/${ctx.chainContextId}/natural-persons`,
      {
        actor: 'NL.NHR.30000070',
        person_ref: 'p',
      },
    );
    expect(r.status).toBe(400);
  });

  test('GET natural-persons without actor header → 400', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000080' });
    const r = await harness.ors.get(`/contexts/${ctx.chainContextId}/natural-persons`);
    expect(r.status).toBe(400);
  });
});

describe('ORS — POST /contexts/:id/events', () => {
  test('happy path → 200', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000090' });
    await publishContextEvent(harness, {
      chainContextId: ctx.chainContextId,
      publisher: 'NL.NHR.30000090',
      eventType: 'shipment.departed',
      payload: { eta: '2026-05-01' },
    });
  });

  test('missing event_type → 400', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000091' });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/events`, {
      publisher: 'NL.NHR.30000091',
    });
    expect(r.status).toBe(400);
  });

  test('bad publisher → 400', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.30000092' });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/events`, {
      publisher: 'bogus',
      event_type: 'x',
    });
    expect(r.status).toBe(400);
  });
});
