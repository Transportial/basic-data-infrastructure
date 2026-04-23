// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { FetchHttpClient, RecordingHttpClient } from '../../src/infrastructure/http-client.ts';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/delivery-repository.ts';
import type { WebhookDelivery } from '../../src/domain/webhook.ts';

describe('FetchHttpClient', () => {
  test('uses injected fetcher', async () => {
    const fake = (async (_url: string, init?: RequestInit) => {
      void init;
      return new Response('', { status: 202 });
    }) as unknown as typeof fetch;
    const c = new FetchHttpClient(fake);
    const r = await c.post('http://x', 'body', { 'x-a': '1' });
    expect(r.status).toBe(202);
  });
});

describe('RecordingHttpClient', () => {
  test('records calls and returns configurable status', async () => {
    const c = new RecordingHttpClient((n) => (n === 1 ? 500 : 200));
    expect((await c.post('http://x', 'b', {})).status).toBe(500);
    expect((await c.post('http://x', 'b', {})).status).toBe(200);
    expect(c.calls).toHaveLength(2);
  });

  test('default status 200', async () => {
    const c = new RecordingHttpClient();
    expect((await c.post('http://x', 'b', {})).status).toBe(200);
  });
});

describe('InMemoryDeliveryRepository', () => {
  function mk(id: string, status: WebhookDelivery['status'] = 'pending'): WebhookDelivery {
    return {
      id,
      direction: 'outbound',
      target_url: 'https://x',
      event_id: 'e',
      event_type: 't',
      attempts: 0,
      status,
      last_http_status: null,
      last_error: null,
      created_at: 'now',
      completed_at: null,
      body: '{}',
    };
  }

  test('save + find', async () => {
    const r = new InMemoryDeliveryRepository();
    await r.save(mk('1'));
    expect((await r.find('1'))?.id).toBe('1');
    expect(await r.find('x')).toBeNull();
  });

  test('listPending/listDead', async () => {
    const r = new InMemoryDeliveryRepository();
    await r.save(mk('1', 'pending'));
    await r.save(mk('2', 'dead'));
    await r.save(mk('3', 'delivered'));
    expect((await r.listPending())).toHaveLength(1);
    expect((await r.listDead())).toHaveLength(1);
  });
});
