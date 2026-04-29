// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  parseAssociationId,
  parseChainContextId,
  parseConnectorId,
  parseEuid,
} from '@transportial/kernel';
import { createChainContext } from '../../src/domain/model/chain-context.ts';
import {
  InMemoryChainContextRepository,
  InMemorySubscriptionRepository,
} from '../../src/infrastructure/repositories/in-memory.ts';
import { InMemoryConnectorLookup } from '../../src/infrastructure/connector-lookup.ts';
import { validateSubscription } from '../../src/domain/model/subscription.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const orch = parseEuid('NL.NHR.11111111');
const other = parseEuid('NL.NHR.22222222');
if (!orch.ok || !other.ok) throw new Error('setup');
const id1 = parseChainContextId('9f3a2c10-1234-4abc-89ab-cdef01234567');
const id2 = parseChainContextId('9f3a2c10-1234-4abc-89ab-cdef01234568');
if (!id1.ok || !id2.ok) throw new Error('setup');
const conId = parseConnectorId('urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

describe('InMemoryChainContextRepository', () => {
  test('save + find', async () => {
    const r = new InMemoryChainContextRepository();
    const c = createChainContext({
      id: id1.value,
      association_id: assoc.value,
      orchestrator_member_id: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
      created_at: 'x',
    });
    await r.save(c);
    expect((await r.find(id1.value))?.id).toBe(id1.value);
    expect(await r.find(id2.value)).toBeNull();
  });

  test('listByOrchestrator', async () => {
    const r = new InMemoryChainContextRepository();
    await r.save(
      createChainContext({
        id: id1.value,
        association_id: assoc.value,
        orchestrator_member_id: orch.value,
        kind: 'shipment',
        identifiers: [],
        valid_from: 'x',
        valid_until: null,
        created_at: 'x',
      }),
    );
    await r.save(
      createChainContext({
        id: id2.value,
        association_id: assoc.value,
        orchestrator_member_id: other.value,
        kind: 'shipment',
        identifiers: [],
        valid_from: 'x',
        valid_until: null,
        created_at: 'x',
      }),
    );
    expect(await r.listByOrchestrator(orch.value)).toHaveLength(1);
  });

  test('listByParty', async () => {
    const r = new InMemoryChainContextRepository();
    await r.save(
      createChainContext({
        id: id1.value,
        association_id: assoc.value,
        orchestrator_member_id: orch.value,
        kind: 'shipment',
        identifiers: [],
        valid_from: 'x',
        valid_until: null,
        created_at: 'x',
      }),
    );
    expect(await r.listByParty(orch.value)).toHaveLength(1);
    expect(await r.listByParty(other.value)).toHaveLength(0);
  });

  test('listByAssociation', async () => {
    const r = new InMemoryChainContextRepository();
    await r.save(
      createChainContext({
        id: id1.value,
        association_id: assoc.value,
        orchestrator_member_id: orch.value,
        kind: 'shipment',
        identifiers: [],
        valid_from: 'x',
        valid_until: null,
        created_at: 'x',
      }),
    );
    expect(await r.listByAssociation(assoc.value)).toHaveLength(1);
  });
});

describe('InMemorySubscriptionRepository', () => {
  const sub = validateSubscription({
    id: 's-1',
    chain_context_id: id1.value,
    subscriber_euid: other.value,
    subscriber_connector_id: conId.value,
    event_types: ['x'],
    callback_url: 'https://example.com/hook',
    allowedCallbacks: ['https://example.com/hook'],
    created_at: 'now',
  });
  if (!sub.ok) throw new Error('setup');

  test('save + find', async () => {
    const r = new InMemorySubscriptionRepository();
    await r.save(sub.value);
    expect((await r.find('s-1'))?.id).toBe('s-1');
    expect(await r.find('missing')).toBeNull();
  });

  test('listByContext', async () => {
    const r = new InMemorySubscriptionRepository();
    await r.save(sub.value);
    expect(await r.listByContext(id1.value)).toHaveLength(1);
    expect(await r.listByContext(id2.value)).toHaveLength(0);
  });

  test('listBySubscriber', async () => {
    const r = new InMemorySubscriptionRepository();
    await r.save(sub.value);
    expect(await r.listBySubscriber(other.value)).toHaveLength(1);
    expect(await r.listBySubscriber(orch.value)).toHaveLength(0);
  });
});

describe('InMemoryConnectorLookup', () => {
  test('register + lookup', async () => {
    const l = new InMemoryConnectorLookup();
    l.register(conId.value, ['https://a', 'https://b']);
    expect(await l.listCallbacks(conId.value)).toHaveLength(2);
  });

  test('unknown connector → empty list', async () => {
    const l = new InMemoryConnectorLookup();
    expect(await l.listCallbacks('unknown')).toHaveLength(0);
  });
});
