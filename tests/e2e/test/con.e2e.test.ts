// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { compactSign } from '@transportial/crypto';
import {
  createHarness,
  mintBvad,
  mintBvod,
  type BdiHarness,
} from '../src/index.ts';

let harness: BdiHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.stop();
});

describe('CON — health and observability', () => {
  test('GET /health/live → 200', async () => {
    expect((await harness.con.get('/health/live')).status).toBe(200);
  });
  test('GET /health/ready → 200', async () => {
    expect((await harness.con.get('/health/ready')).status).toBe(200);
  });
  test('GET /health/startup → 200', async () => {
    expect((await harness.con.get('/health/startup')).status).toBe(200);
  });
  test('GET /metrics → 200', async () => {
    const r = await harness.con.get('/metrics');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });
  test('unknown route → 404', async () => {
    expect((await harness.con.get('/nope')).status).toBe(404);
  });
  test('invalid JSON on /proxy/check → 400', async () => {
    const res = await harness.con.fetch(
      new Request(harness.con.url('/proxy/check'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '!!',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('CON — POST /proxy/check', () => {
  test('without tokens → 401', async () => {
    const r = await harness.con.post('/proxy/check', {
      action: 'read',
      resource: { type: 't', id: '1' },
    });
    expect(r.status).toBe(401);
  });

  test('with valid BVAD + BVOD → 200', async () => {
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.40000001';
    const chainContextId = `00000000-0000-4000-8000-${'0'.repeat(11)}1`;
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const bvod = await mintBvod(harness, {
      chainContextId,
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const r = await harness.con.post<{ ok: boolean; subject: string }>('/proxy/check', {
      bvad,
      bvod,
      action: 'read:shipment',
      resource: { type: 'Shipment', id: 's-1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.subject).toBe(peerConnector);
  });

  test('BVAD with wrong issuer → 401', async () => {
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.40000002';
    const chainContextId = `00000000-0000-4000-8000-${'0'.repeat(11)}2`;
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
      issuerOverride: 'https://impostor',
    });
    const bvod = await mintBvod(harness, {
      chainContextId,
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const r = await harness.con.post('/proxy/check', {
      bvad,
      bvod,
      action: 'read:shipment',
      resource: { type: 'Shipment', id: 's-1' },
    });
    expect(r.status).toBe(401);
  });

  test('BVAD with non-active status → 401 (rejected at validation)', async () => {
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.40000003';
    const chainContextId = `00000000-0000-4000-8000-${'0'.repeat(11)}3`;
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
      statusOverride: 'suspended',
    });
    const bvod = await mintBvod(harness, {
      chainContextId,
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const r = await harness.con.post('/proxy/check', {
      bvad,
      bvod,
      action: 'read',
      resource: { type: 't', id: '1' },
    });
    expect(r.status).toBe(401);
  });

  test('policy denial → 403', async () => {
    // Boot with a forbid-all policy so the PDP rejects after BVAD/BVOD
    // validation succeeds. Exercises the policy-denied → 403 branch in
    // statusForVerifyError().
    await harness.stop();
    harness = await createHarness({
      con: {
        policies: [
          { id: 'forbid-all', effect: 'forbid', actions: '*', resourceTypes: '*' },
        ],
      },
    });

    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.40000004';
    const chainContextId = `00000000-0000-4000-8000-${'0'.repeat(11)}4`;
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const bvod = await mintBvod(harness, {
      chainContextId,
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const r = await harness.con.post('/proxy/check', {
      bvad,
      bvod,
      action: 'read',
      resource: { type: 't', id: '1' },
    });
    expect(r.status).toBe(403);
  });
});

describe('CON — /proxy-upstream/*', () => {
  test('forwards verified requests to the configured upstream', async () => {
    // Stand up a fake upstream that records what it received.
    const upstreamBase = 'https://upstream.bdi.test';
    const received: Array<{ method: string; path: string; body: string }> = [];
    // Boot a fresh harness with the upstream pre-configured. A fresh boot is
    // simpler than trying to reconfigure the existing one mid-test.
    await harness.stop();
    harness = await createHarness({
      con: {
        upstreams: [
          { pathPrefix: '/erp', target: upstreamBase, stripPrefix: true },
        ],
      },
    });
    harness.registerService(upstreamBase, async (req) => {
      const url = new URL(req.url);
      received.push({ method: req.method, path: url.pathname, body: await req.text() });
      return new Response(JSON.stringify({ echoed: true, path: url.pathname }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.40000010';
    const chainContextId = `00000000-0000-4000-8000-${'0'.repeat(11)}a`;
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const bvod = await mintBvod(harness, {
      chainContextId,
      subjectConnectorId: peerConnector,
      memberEuid,
    });

    const res = await harness.con.fetch(
      new Request(harness.con.url('/proxy-upstream/erp/orders'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bvad}`,
          'x-bdi-context': bvod,
          'x-bdi-action': 'read:shipment',
          'x-bdi-resource': JSON.stringify({ type: 'Shipment', id: 's-1' }),
        },
        body: JSON.stringify({ ref: 'ORD-1' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe('POST');
    expect(received[0]?.path).toBe('/orders');
  });

  test('without valid tokens → 401', async () => {
    const res = await harness.con.fetch(
      new Request(harness.con.url('/proxy-upstream/erp/orders'), {
        method: 'GET',
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('CON — /webhooks/outbound', () => {
  test('happy path → 202 with delivery_id', async () => {
    const target = 'https://receiver.bdi.test';
    harness.registerService(target, async () => new Response(null, { status: 200 }));
    const r = await harness.con.post<{ delivery_id: string; state: string }>(
      '/webhooks/outbound',
      {
        target_url: `${target}/hook`,
        event_id: 'evt-1',
        event_type: 'ors.context.event-occurred',
        payload: { hi: 1 },
      },
    );
    expect(r.status).toBe(202);
    expect(r.body.state).toBe('delivered');
    expect(typeof r.body.delivery_id).toBe('string');
  });

  test('missing required fields → 400', async () => {
    const r = await harness.con.post('/webhooks/outbound', { target_url: 'https://x' });
    expect(r.status).toBe(400);
  });

  test('GET /webhooks/deliveries lists deliveries', async () => {
    const target = 'https://receiver.bdi.test';
    harness.registerService(target, async () => new Response(null, { status: 200 }));
    await harness.con.post('/webhooks/outbound', {
      target_url: `${target}/hook`,
      event_id: 'evt-list',
      event_type: 'x',
      payload: {},
    });
    const r = await harness.con.get<{
      pending: ReadonlyArray<unknown>;
      dead: ReadonlyArray<unknown>;
    }>('/webhooks/deliveries');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.pending)).toBe(true);
    expect(Array.isArray(r.body.dead)).toBe(true);
  });

  test('GET /webhooks/deliveries/:id for unknown → 404', async () => {
    const r = await harness.con.get('/webhooks/deliveries/does-not-exist');
    expect(r.status).toBe(404);
  });

  test('GET /webhooks/deliveries/:id for known → 200', async () => {
    const target = 'https://receiver.bdi.test';
    harness.registerService(target, async () => new Response(null, { status: 200 }));
    const post = await harness.con.post<{ delivery_id: string }>(
      '/webhooks/outbound',
      {
        target_url: `${target}/hook`,
        event_id: 'evt-get',
        event_type: 'x',
        payload: {},
      },
    );
    const r = await harness.con.get(`/webhooks/deliveries/${post.body.delivery_id}`);
    expect(r.status).toBe(200);
  });
});

describe('CON — /webhooks/inbound', () => {
  test('signed webhook from allowed issuer → 202', async () => {
    const body = JSON.stringify({ hi: 1 });
    const bodySha = await sha256B64(new TextEncoder().encode(body));
    const jws = await compactSign(
      { body_sha256: bodySha, iss: harness.issuers.asr },
      harness.signers.asr.signer,
      { kid: harness.signers.asr.kid, alg: 'ES256' },
    );
    const res = await harness.con.fetch(
      new Request(harness.con.url('/webhooks/inbound'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'bdi-signature': jws,
          'bdi-event-id': 'evt-inbound-1',
          'bdi-event-type': 'ors.context.event-occurred',
          'bdi-issuer': harness.issuers.asr,
        },
        body,
      }),
    );
    expect(res.status).toBe(202);
  });

  test('missing BDI headers → 400', async () => {
    const res = await harness.con.fetch(
      new Request(harness.con.url('/webhooks/inbound'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('disallowed issuer → 403', async () => {
    const body = JSON.stringify({ hi: 1 });
    const bodySha = await sha256B64(new TextEncoder().encode(body));
    const jws = await compactSign(
      { body_sha256: bodySha, iss: 'https://impostor' },
      harness.signers.asr.signer,
      { kid: harness.signers.asr.kid, alg: 'ES256' },
    );
    const res = await harness.con.fetch(
      new Request(harness.con.url('/webhooks/inbound'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'bdi-signature': jws,
          'bdi-event-id': 'evt-inbound-bad-issuer',
          'bdi-event-type': 'x',
          'bdi-issuer': 'https://impostor',
        },
        body,
      }),
    );
    expect(res.status).toBe(403);
  });

  test('replayed event_id → 409', async () => {
    const body = JSON.stringify({ hi: 1 });
    const bodySha = await sha256B64(new TextEncoder().encode(body));
    const jws = await compactSign(
      { body_sha256: bodySha, iss: harness.issuers.asr },
      harness.signers.asr.signer,
      { kid: harness.signers.asr.kid, alg: 'ES256' },
    );
    const headers = {
      'content-type': 'application/json',
      'bdi-signature': jws,
      'bdi-event-id': 'evt-inbound-replay',
      'bdi-event-type': 'x',
      'bdi-issuer': harness.issuers.asr,
    };
    const first = await harness.con.fetch(
      new Request(harness.con.url('/webhooks/inbound'), {
        method: 'POST',
        headers,
        body,
      }),
    );
    expect(first.status).toBe(202);
    const second = await harness.con.fetch(
      new Request(harness.con.url('/webhooks/inbound'), {
        method: 'POST',
        headers,
        body,
      }),
    );
    expect(second.status).toBe(409);
  });
});

async function sha256B64(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let s = '';
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
