// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  openDeliveryDb,
  SqliteDeliveryRepository,
} from '../../src/infrastructure/sqlite-delivery-repository.ts';
import type { WebhookDelivery } from '../../src/domain/webhook.ts';

function mk(id: string, status: WebhookDelivery['status'] = 'pending'): WebhookDelivery {
  return {
    id,
    direction: 'outbound',
    target_url: 'https://example.com/hook',
    event_id: 'evt-1',
    event_type: 'ors.context.event-occurred',
    attempts: 0,
    status,
    last_http_status: null,
    last_error: null,
    created_at: 'now',
    completed_at: null,
    body: '{}',
  };
}

describe('SqliteDeliveryRepository', () => {
  test('save + find', async () => {
    const db = openDeliveryDb();
    const repo = new SqliteDeliveryRepository(db);
    await repo.save(mk('1'));
    expect((await repo.find('1'))?.id).toBe('1');
    expect(await repo.find('missing')).toBeNull();
  });

  test('update in place', async () => {
    const db = openDeliveryDb();
    const repo = new SqliteDeliveryRepository(db);
    await repo.save(mk('1', 'pending'));
    await repo.save({
      ...mk('1', 'delivered'),
      attempts: 1,
      last_http_status: 200,
      completed_at: '2026-04-23T00:00:00Z',
    });
    const loaded = await repo.find('1');
    expect(loaded?.status).toBe('delivered');
    expect(loaded?.attempts).toBe(1);
    expect(loaded?.last_http_status).toBe(200);
  });

  test('listPending/listDead', async () => {
    const db = openDeliveryDb();
    const repo = new SqliteDeliveryRepository(db);
    await repo.save(mk('1', 'pending'));
    await repo.save(mk('2', 'dead'));
    await repo.save(mk('3', 'delivered'));
    expect(await repo.listPending()).toHaveLength(1);
    expect(await repo.listDead()).toHaveLength(1);
  });
});
