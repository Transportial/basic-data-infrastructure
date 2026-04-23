// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import type { AssociationId, ChainContextId, Euid } from '@bdi/kernel';
import {
  PostgresChainContextRepository,
  PostgresSubscriptionRepository,
  InMemorySqlPort,
} from '../../src/infrastructure/repositories/postgres.ts';
import type { ChainContext } from '../../src/domain/model/chain-context.ts';
import type { Subscription } from '../../src/domain/model/subscription.ts';

function ctx(id: string, assoc: string, orch: string): ChainContext {
  return {
    id: id as ChainContextId,
    association_id: assoc as AssociationId,
    orchestrator_member_id: orch as Euid,
    kind: 'transport',
    status: 'planned',
    identifiers: [{ scheme: 'BOL', value: id }],
    parties: [
      {
        member_euid: orch as Euid,
        roles: ['orchestrator'],
        added_at: '2026-04-01T00:00:00Z',
        added_by_member: orch as Euid,
        valid_from: '2026-04-01T00:00:00Z',
        valid_until: null,
      },
    ],
    delegations: [],
    natural_persons: [],
    valid_from: '2026-04-01T00:00:00Z',
    valid_until: null,
    created_at: '2026-04-01T00:00:00Z',
  };
}

function sub(id: string, ccId: string): Subscription {
  return {
    id,
    chain_context_id: ccId as ChainContextId,
    subscriber_euid: 'eu.nl:kvk:1' as Euid,
    subscriber_connector_id: 'con-1' as Subscription['subscriber_connector_id'],
    event_types: ['shipment.dispatched'],
    callback_url: 'https://peer.example/wh',
    active: true,
    created_at: '2026-04-02T00:00:00Z',
  };
}

describe('PostgresChainContextRepository', () => {
  test('save then find returns the context', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresChainContextRepository(sql);
    const c = ctx('cc-1', 'assoc-a', 'eu.nl:kvk:1');
    await repo.save(c);
    const found = await repo.find('cc-1' as ChainContextId);
    expect(found?.id).toBe('cc-1');
    expect(found?.association_id).toBe('assoc-a');
    expect(found?.parties).toHaveLength(1);
  });

  test('listByOrchestrator filters by EUID', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresChainContextRepository(sql);
    await repo.save(ctx('cc-1', 'a', 'eu.nl:kvk:1'));
    await repo.save(ctx('cc-2', 'a', 'eu.nl:kvk:2'));
    const byOne = await repo.listByOrchestrator('eu.nl:kvk:1' as Euid);
    expect(byOne).toHaveLength(1);
    expect(byOne[0]?.id).toBe('cc-1');
  });

  test('listByAssociation filters by association', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresChainContextRepository(sql);
    await repo.save(ctx('cc-1', 'a', 'eu.nl:kvk:1'));
    await repo.save(ctx('cc-2', 'b', 'eu.nl:kvk:1'));
    const a = await repo.listByAssociation('a' as AssociationId);
    expect(a).toHaveLength(1);
    expect(a[0]?.id).toBe('cc-1');
  });
});

describe('PostgresSubscriptionRepository', () => {
  test('save then find', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresSubscriptionRepository(sql);
    await repo.save(sub('s-1', 'cc-1'));
    const got = await repo.find('s-1');
    expect(got?.id).toBe('s-1');
    expect(got?.event_types).toEqual(['shipment.dispatched']);
  });

  test('listByContext + listBySubscriber', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresSubscriptionRepository(sql);
    await repo.save(sub('s-1', 'cc-1'));
    await repo.save(sub('s-2', 'cc-1'));
    await repo.save(sub('s-3', 'cc-2'));
    const ccOne = await repo.listByContext('cc-1' as ChainContextId);
    expect(ccOne).toHaveLength(2);
    const bySub = await repo.listBySubscriber('eu.nl:kvk:1' as Euid);
    expect(bySub).toHaveLength(3);
  });
});
