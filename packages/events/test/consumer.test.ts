// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import type { EventEnvelope } from '@bdi/contracts';
import { InMemoryConsumer, classifyDelivery, serialiseError } from '../src/consumer.ts';

function mkEnvelope(body: unknown): EventEnvelope {
  return {
    id: 'e1',
    occurred_at: '2026-04-23T00:00:00Z',
    producer: { service: 'asr', instance: 'i', version: '0' },
    association_id: 'ctn',
    type: 't',
    schema_version: 1,
    trace: { trace_id: 't', span_id: 's' },
    body,
  };
}

describe('serialiseError', () => {
  test('formats Error', () => {
    expect(serialiseError(new TypeError('boom'))).toBe('TypeError: boom');
  });
  test('passes string through', () => {
    expect(serialiseError('oops')).toBe('oops');
  });
  test('stringifies object', () => {
    expect(serialiseError({ a: 1 })).toContain('"a":1');
  });
  test('handles circular refs', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(serialiseError(a)).toBe('unserialisable error');
  });
});

describe('classifyDelivery', () => {
  test('under max → retry', () => {
    expect(classifyDelivery(1, new Error('x'), { maxDeliveries: 3 }).action).toBe('retry');
  });
  test('at max → dead-letter', () => {
    expect(classifyDelivery(3, new Error('x'), { maxDeliveries: 3 }).action).toBe('dead-letter');
  });
});

describe('InMemoryConsumer', () => {
  test('ticks with nothing pending returns null', async () => {
    const c = new InMemoryConsumer(async () => {});
    expect(await c.tick()).toBeNull();
  });

  test('acks successful handler', async () => {
    const c = new InMemoryConsumer(async () => {});
    c.submit(mkEnvelope({}));
    const d = await c.tick();
    expect(d?.action).toBe('ack');
    expect(c.pendingCount()).toBe(0);
  });

  test('retries on first failure', async () => {
    let attempts = 0;
    const c = new InMemoryConsumer(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('fail once');
      },
      { maxDeliveries: 3 },
    );
    c.submit(mkEnvelope({}));
    const first = await c.tick();
    expect(first?.action).toBe('retry');
    expect(c.pendingCount()).toBe(1);
    const second = await c.tick();
    expect(second?.action).toBe('ack');
  });

  test('dead-letters after max deliveries', async () => {
    const c = new InMemoryConsumer(
      async () => {
        throw new Error('always');
      },
      { maxDeliveries: 2 },
    );
    c.submit(mkEnvelope({}));
    await c.tick(); // retry (delivery 1)
    const second = await c.tick(); // dead-letter (delivery 2)
    expect(second?.action).toBe('dead-letter');
    expect(c.deadLetterCount()).toBe(1);
    expect(c.snapshotDead()[0]?.lastError).toContain('always');
  });

  test('uses default policy when not supplied', async () => {
    let attempts = 0;
    const c = new InMemoryConsumer(async () => {
      attempts += 1;
      throw new Error('x');
    });
    c.submit(mkEnvelope({}));
    // 5 retries ends in a dead-letter on the 5th delivery
    for (let i = 0; i < 5; i++) await c.tick();
    expect(c.deadLetterCount()).toBe(1);
    expect(attempts).toBe(5);
  });
});
