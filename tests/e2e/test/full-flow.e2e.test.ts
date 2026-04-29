// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  addParty,
  createChainContext,
  createHarness,
  onboardActiveMember,
  publishContextEvent,
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

// Walks the canonical BDI lifecycle across all three services in one test
// run. Each step uses scenario helpers so the story stays readable.
describe('canonical BDI flow', () => {
  test('onboard members → register connectors → create context → exchange BVOD', async () => {
    // 1. ASR onboards two members, both reaching `activated` state.
    const carrier = await onboardActiveMember(harness, {
      euid: 'NL.NHR.10000001',
      legalName: 'Carrier BV',
    });
    const shipper = await onboardActiveMember(harness, {
      euid: 'NL.NHR.10000002',
      legalName: 'Shipper BV',
    });

    expect(carrier.memberId).toBeTruthy();
    expect(shipper.memberId).toBeTruthy();

    // 2. Each member registers a connector with ASR.
    const carrierConnector = await registerConnector(harness, {
      memberId: carrier.memberId,
      clientId: 'carrier-client-1',
    });
    const shipperConnector = await registerConnector(harness, {
      memberId: shipper.memberId,
      clientId: 'shipper-client-1',
    });

    expect(carrierConnector.connectorId).toBeTruthy();
    expect(shipperConnector.connectorId).toBeTruthy();

    // 3. ASR publishes a trustlist for the association.
    const trustlist = await harness.asr.get(
      `/.well-known/bdi/trustlist/${harness.associationId}`,
    );
    expect(trustlist.status).toBe(200);
    expect(trustlist.headers.get('content-type')).toBe('application/jose');

    // 4. Member descriptors are signed and retrievable.
    const carrierDescriptor = await harness.asr.get(
      `/.well-known/bdi/members/NL.NHR.10000001`,
    );
    expect(carrierDescriptor.status).toBe(200);

    // 5. ASR's JWKS exposes the active signing key.
    const jwks = await harness.asr.get<{ keys: ReadonlyArray<unknown> }>(
      '/.well-known/jwks.json',
    );
    expect(jwks.status).toBe(200);
    expect(jwks.body.keys.length).toBeGreaterThan(0);

    // 6. ORS creates a chain context orchestrated by the shipper.
    const ctx = await createChainContext(harness, {
      orchestrator: 'NL.NHR.10000002',
      kind: 'shipment',
      identifiers: [{ scheme: 'bl', value: 'MSCU-E2E-001' }],
    });
    expect(ctx.chainContextId).toBeTruthy();

    // 7. Shipper adds carrier as a party with the `carrier` role.
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.10000002',
      memberEuid: 'NL.NHR.10000001',
      roles: ['carrier'],
    });

    // 8. ORS issues a BVOD for the carrier connector — the orchestration
    //    proof of involvement that the connector layer will check.
    const bvod = await harness.ors.post<{ bvod: string }>(
      `/contexts/${ctx.chainContextId}/bvod`,
      {
        subject_euid: 'NL.NHR.10000001',
        subject_connector_id: carrierConnector.connectorId,
      },
    );
    expect(bvod.status).toBe(200);
    expect(typeof bvod.body.bvod).toBe('string');
    expect(bvod.body.bvod.split('.')).toHaveLength(3);

    // 9. Publishing a context event from the orchestrator succeeds.
    await publishContextEvent(harness, {
      chainContextId: ctx.chainContextId,
      publisher: 'NL.NHR.10000002',
      eventType: 'order.created',
      payload: { order_ref: 'ORD-1' },
    });

    // 10. Domain events were emitted onto ASR's and ORS's in-memory buses
    //     along the way — verify a few key milestones to catch silent
    //     regressions.
    const asrEvents = harness.composition.asr.deps.bus.published.map((e) => e.type);
    expect(asrEvents).toContain('asr.member.activated');
    expect(asrEvents).toContain('asr.connector.registered');

    const orsEvents = harness.composition.ors.deps.bus.published.map((e) => e.type);
    expect(orsEvents).toContain('ors.context.created');
    expect(orsEvents).toContain('ors.context.party-added');
    expect(orsEvents).toContain('ors.context.event-occurred');
  });

  test('CON webhook delivery routes through the harness network', async () => {
    // Stand up a fake receiver registered on the harness network. When CON's
    // outbound webhook fires, the network routes the request here instead of
    // going over real sockets.
    const received: Array<{ url: string; body: string }> = [];
    const receiverUrl = 'https://receiver.bdi.test';
    harness.registerService(receiverUrl, async (req) => {
      received.push({ url: req.url, body: await req.text() });
      return new Response(null, { status: 200 });
    });

    const res = await harness.con.post<{ delivery_id: string; state: string }>(
      '/webhooks/outbound',
      {
        target_url: `${receiverUrl}/hook`,
        event_id: 'evt-1',
        event_type: 'ors.context.event-occurred',
        payload: { hello: 'world' },
      },
    );

    expect(res.status).toBe(202);
    expect(res.body.state).toBe('delivered');
    expect(received).toHaveLength(1);
    expect(received[0]?.url).toBe(`${receiverUrl}/hook`);
    expect(JSON.parse(received[0]!.body)).toEqual({ hello: 'world' });
  });
});
