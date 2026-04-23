// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@bdi/kernel';
import { FakeEventBus } from '@bdi/testing';
import { DeliverWebhookUseCase } from '../../src/application/use-cases/deliver-webhook.ts';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/delivery-repository.ts';
import type { WebhookDelivery } from '../../src/domain/webhook.ts';
import type { HttpClientPort } from '../../src/application/ports.ts';

class StubHttp implements HttpClientPort {
  constructor(private readonly statusOrThrow: number | 'throw') {}
  async post(): Promise<{ status: number }> {
    if (this.statusOrThrow === 'throw') throw new Error('net');
    return { status: this.statusOrThrow };
  }
}

function mk(): WebhookDelivery {
  return {
    id: 'd1',
    direction: 'outbound',
    target_url: 'https://x',
    event_id: 'e',
    event_type: 't',
    attempts: 0,
    status: 'pending',
    last_http_status: null,
    last_error: null,
    created_at: 'now',
    completed_at: null,
    body: '{}',
  };
}

describe('DeliverWebhookUseCase', () => {
  test('2xx → delivered', async () => {
    const http = new StubHttp(200);
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
      rand: () => 0.5,
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('delivered');
    expect(bus.findAllOfType('con.webhook.delivered')).toHaveLength(1);
  });

  test('5xx → retry', async () => {
    const http = new StubHttp(500);
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
      rand: () => 0.5,
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('retry');
    expect(bus.findAllOfType('con.webhook.failed')).toHaveLength(1);
  });

  test('5xx at max → dead', async () => {
    const http = new StubHttp(500);
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
      policy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        factor: 1,
        jitter: 0,
      },
      rand: () => 0.5,
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('dead');
    expect(bus.findAllOfType('con.webhook.dead-lettered')).toHaveLength(1);
  });

  test('400 → client-error permanent', async () => {
    const http = new StubHttp(400);
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
      rand: () => 0.5,
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('client-error');
  });

  test('network error → treated as 599 and retries', async () => {
    const http = new StubHttp('throw');
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
      rand: () => 0.5,
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('retry');
    const stored = await repo.find('d1');
    expect(stored?.last_error).toBe('net');
  });

  test('uses default rand when not supplied', async () => {
    const http = new StubHttp(500);
    const repo = new InMemoryDeliveryRepository();
    const bus = new FakeEventBus();
    const uc = new DeliverWebhookUseCase(http, repo, bus, new FakeClock(), {
      associationId: 'ctn',
    });
    const r = await uc.execute({ delivery: mk() });
    expect(r.ok && (r.value as { state: string }).state).toBe('retry');
  });
});
