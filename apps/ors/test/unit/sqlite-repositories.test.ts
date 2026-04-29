// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  parseAssociationId,
  parseChainContextId,
  parseConnectorId,
  parseEuid,
} from '@transportial/kernel';
import {
  openSqlite,
  SqliteChainContextRepository,
  SqliteSubscriptionRepository,
} from '../../src/infrastructure/repositories/sqlite.ts';
import { createChainContext } from '../../src/domain/model/chain-context.ts';
import { validateSubscription } from '../../src/domain/model/subscription.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const orch = parseEuid('NL.NHR.11111111');
const other = parseEuid('NL.NHR.22222222');
if (!orch.ok || !other.ok) throw new Error('setup');
const cid1 = parseChainContextId('9f3a2c10-1234-4abc-89ab-cdef01234567');
const cid2 = parseChainContextId('9f3a2c10-1234-4abc-89ab-cdef01234568');
if (!cid1.ok || !cid2.ok) throw new Error('setup');
const connId = parseConnectorId('urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!connId.ok) throw new Error('setup');

function ctx(id: typeof cid1.value, orchestrator: typeof orch.value) {
  return createChainContext({
    id,
    association_id: assoc.value,
    orchestrator_member_id: orchestrator,
    kind: 'shipment',
    identifiers: [{ scheme: 'bl', value: 'MSCU1' }],
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: null,
    created_at: '2026-01-01T00:00:00Z',
  });
}

describe('SqliteChainContextRepository', () => {
  test('save + find round-trip', async () => {
    const db = openSqlite();
    const repo = new SqliteChainContextRepository(db);
    await repo.save(ctx(cid1.value, orch.value));
    const loaded = await repo.find(cid1.value);
    expect(loaded?.id).toBe(cid1.value);
    expect(loaded?.parties).toHaveLength(1);
  });

  test('update existing', async () => {
    const db = openSqlite();
    const repo = new SqliteChainContextRepository(db);
    const c = ctx(cid1.value, orch.value);
    await repo.save(c);
    await repo.save({ ...c, status: 'active' });
    expect((await repo.find(cid1.value))?.status).toBe('active');
  });

  test('listByOrchestrator / listByAssociation / listByParty', async () => {
    const db = openSqlite();
    const repo = new SqliteChainContextRepository(db);
    await repo.save(ctx(cid1.value, orch.value));
    await repo.save(ctx(cid2.value, other.value));
    expect(await repo.listByAssociation(assoc.value)).toHaveLength(2);
    expect(await repo.listByOrchestrator(orch.value)).toHaveLength(1);
    expect(await repo.listByParty(orch.value)).toHaveLength(1);
    expect(await repo.listByParty(other.value)).toHaveLength(1);
  });

  test('find missing returns null', async () => {
    const db = openSqlite();
    const repo = new SqliteChainContextRepository(db);
    expect(await repo.find(cid1.value)).toBeNull();
  });
});

describe('SqliteSubscriptionRepository', () => {
  test('save + find + listByContext + listBySubscriber', async () => {
    const db = openSqlite();
    const contexts = new SqliteChainContextRepository(db);
    const repo = new SqliteSubscriptionRepository(db);
    await contexts.save(ctx(cid1.value, orch.value));
    const sub = validateSubscription({
      id: 's-1',
      chain_context_id: cid1.value,
      subscriber_euid: other.value,
      subscriber_connector_id: connId.value,
      event_types: ['eta_updated'],
      callback_url: 'https://example.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    if (!sub.ok) throw new Error('setup');
    await repo.save(sub.value);
    expect((await repo.find('s-1'))?.id).toBe('s-1');
    expect(await repo.find('missing')).toBeNull();
    expect(await repo.listByContext(cid1.value)).toHaveLength(1);
    expect(await repo.listBySubscriber(other.value)).toHaveLength(1);
    expect(await repo.listBySubscriber(orch.value)).toHaveLength(0);
  });

  test('update flips active flag', async () => {
    const db = openSqlite();
    const repo = new SqliteSubscriptionRepository(db);
    await new SqliteChainContextRepository(db).save(ctx(cid1.value, orch.value));
    const sub = validateSubscription({
      id: 's-1',
      chain_context_id: cid1.value,
      subscriber_euid: other.value,
      subscriber_connector_id: connId.value,
      event_types: ['t'],
      callback_url: 'https://example.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    if (!sub.ok) throw new Error('setup');
    await repo.save(sub.value);
    await repo.save({ ...sub.value, active: false });
    expect((await repo.find('s-1'))?.active).toBe(false);
  });
});
