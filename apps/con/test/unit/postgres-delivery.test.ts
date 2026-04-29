// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  PostgresDeliveryRepository,
  InMemorySqlPort,
} from '../../src/infrastructure/postgres-delivery-repository.ts';
import type { WebhookDelivery } from '../../src/domain/webhook.ts';

function delivery(id: string, status: WebhookDelivery['status']): WebhookDelivery {
  return {
    id,
    direction: 'outbound',
    target_url: 'https://peer.example/wh',
    event_id: 'evt-1',
    event_type: 'shipment.dispatched',
    attempts: 1,
    status,
    last_http_status: status === 'delivered' ? 200 : null,
    last_error: status === 'failed' ? 'timeout' : null,
    body: '{"foo":"bar"}',
    created_at: '2026-04-23T12:00:00Z',
    completed_at: status === 'delivered' ? '2026-04-23T12:00:05Z' : null,
  };
}

describe('PostgresDeliveryRepository', () => {
  test('save then find roundtrips all fields', async () => {
    const repo = new PostgresDeliveryRepository(new InMemorySqlPort());
    const d = delivery('d1', 'delivered');
    await repo.save(d);
    const got = await repo.find('d1');
    expect(got).toEqual(d);
  });

  test('listPending filters by status=pending', async () => {
    const repo = new PostgresDeliveryRepository(new InMemorySqlPort());
    await repo.save(delivery('d1', 'pending'));
    await repo.save(delivery('d2', 'delivered'));
    await repo.save(delivery('d3', 'pending'));
    const pending = await repo.listPending();
    expect(pending.map((d) => d.id).sort()).toEqual(['d1', 'd3']);
  });

  test('listDead filters by status=dead', async () => {
    const repo = new PostgresDeliveryRepository(new InMemorySqlPort());
    await repo.save(delivery('d1', 'dead'));
    await repo.save(delivery('d2', 'pending'));
    const dead = await repo.listDead();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.id).toBe('d1');
  });

  test('saving the same id updates in place (upsert)', async () => {
    const repo = new PostgresDeliveryRepository(new InMemorySqlPort());
    await repo.save(delivery('d1', 'pending'));
    await repo.save({ ...delivery('d1', 'dead'), attempts: 5 });
    const got = await repo.find('d1');
    expect(got?.status).toBe('dead');
    expect(got?.attempts).toBe(5);
  });
});
