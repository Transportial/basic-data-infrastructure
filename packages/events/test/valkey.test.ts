// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  InMemoryValkey,
  ValkeyLock,
  ValkeyStreamBus,
  ValkeyStreamConsumer,
  ValkeyStreamSink,
  ValkeyTokenBucket,
} from '../src/valkey.ts';
import type { EventEnvelope } from '@bdi/contracts';

describe('InMemoryValkey KV', () => {
  test('set + get', async () => {
    const v = new InMemoryValkey();
    expect(await v.set('k', 'v')).toBe('OK');
    expect(await v.get('k')).toBe('v');
  });

  test('setNx only succeeds when key is absent', async () => {
    const v = new InMemoryValkey();
    expect(await v.setNx('k', 'a')).toBe(true);
    expect(await v.setNx('k', 'b')).toBe(false);
    expect(await v.get('k')).toBe('a');
  });

  test('ttl expiration', async () => {
    const v = new InMemoryValkey();
    await v.set('k', 'v', 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(await v.get('k')).toBeNull();
  });

  test('del + incr + expire', async () => {
    const v = new InMemoryValkey();
    expect(await v.incr('c')).toBe(1);
    expect(await v.incr('c')).toBe(2);
    expect(await v.del('c')).toBe(1);
    expect(await v.del('c')).toBe(0);
    await v.set('k', 'v');
    expect(await v.expire('k', 1)).toBe(true);
    expect(await v.expire('missing', 1)).toBe(false);
  });

  test('del_keys_with_prefix', async () => {
    const v = new InMemoryValkey();
    await v.set('a:1', 'x');
    await v.set('a:2', 'x');
    await v.set('b:1', 'x');
    expect(await v.del_keys_with_prefix('a:')).toBe(2);
    expect(await v.get('a:1')).toBeNull();
    expect(await v.get('b:1')).toBe('x');
  });
});

describe('InMemoryValkey streams', () => {
  test('xadd, xlen, xrange', async () => {
    const v = new InMemoryValkey();
    await v.xadd('s', '*', [['k', '1']]);
    await v.xadd('s', '*', [['k', '2']]);
    expect(await v.xlen('s')).toBe(2);
    const range = await v.xrange('s', '-', '+');
    expect(range).toHaveLength(2);
  });

  test('xreadGroup delivers only new entries, xack removes PEL', async () => {
    const v = new InMemoryValkey();
    await v.xgroupCreate('s', 'g', '$', true);
    const id = await v.xadd('s', '*', [['envelope', '{}']]);
    const read = await v.xreadGroup('g', 'c1', [['s', '>']], 10);
    expect(read).toHaveLength(1);
    const [, entries] = read[0]!;
    expect(entries[0]?.[0]).toBe(id);
    const pending = await v.xpending('s', 'g');
    expect(pending).toHaveLength(1);
    await v.xack('s', 'g', id);
    const pending2 = await v.xpending('s', 'g');
    expect(pending2).toHaveLength(0);
  });

  test('xack on missing group/stream returns 0', async () => {
    const v = new InMemoryValkey();
    expect(await v.xack('nope', 'g', '1')).toBe(0);
    await v.xgroupCreate('s', 'g', '$', true);
    expect(await v.xack('s', 'g', 'missing-id')).toBe(0);
  });

  test('xgroupCreate with mkstream=false throws for unknown stream', async () => {
    const v = new InMemoryValkey();
    await expect(v.xgroupCreate('missing', 'g', '$', false)).rejects.toThrow();
  });

  test('xgroupCreate twice is idempotent', async () => {
    const v = new InMemoryValkey();
    await v.xgroupCreate('s', 'g', '0', true);
    await v.xgroupCreate('s', 'g', '0', true);
    expect(await v.xlen('s')).toBe(0);
  });

  test('xrange with start/end + count', async () => {
    const v = new InMemoryValkey();
    await v.xadd('s', '1-0', [['k', 'a']]);
    await v.xadd('s', '2-0', [['k', 'b']]);
    await v.xadd('s', '3-0', [['k', 'c']]);
    const limited = await v.xrange('s', '-', '+', 2);
    expect(limited).toHaveLength(2);
  });

  test('xreadGroup returns nothing for non-existent group', async () => {
    const v = new InMemoryValkey();
    await v.xadd('s', '*', [['k', 'v']]);
    const read = await v.xreadGroup('missing', 'c', [['s', '>']], 10);
    expect(read).toHaveLength(0);
  });

  test('xreadGroup re-delivers entries from PEL when from is not >', async () => {
    const v = new InMemoryValkey();
    await v.xgroupCreate('s', 'g', '$', true);
    const id = await v.xadd('s', '*', [['k', 'v']]);
    await v.xreadGroup('g', 'c1', [['s', '>']], 10);
    const re = await v.xreadGroup('g', 'c1', [['s', '0-0']], 10);
    expect(re).toHaveLength(1);
    expect(re[0]![1][0]![0]).toBe(id);
  });
});

describe('InMemoryValkey pub/sub', () => {
  test('publish delivers to subscribers', async () => {
    const v = new InMemoryValkey();
    const got: string[] = [];
    const unsub = await v.subscribe('ch', (m) => got.push(m));
    const n = await v.publish('ch', 'hi');
    expect(n).toBe(1);
    expect(got).toEqual(['hi']);
    await unsub();
    const n2 = await v.publish('ch', 'again');
    expect(n2).toBe(0);
  });

  test('publish with no subscribers returns 0', async () => {
    const v = new InMemoryValkey();
    expect(await v.publish('mystery', 'm')).toBe(0);
  });

  test('multiple subscribers receive', async () => {
    const v = new InMemoryValkey();
    const a: string[] = [];
    const b: string[] = [];
    await v.subscribe('c', (m) => a.push(m));
    await v.subscribe('c', (m) => b.push(m));
    await v.publish('c', 'x');
    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
  });
});

describe('ValkeyStreamBus + ValkeyStreamConsumer', () => {
  test('publish → consume → ack', async () => {
    const v = new InMemoryValkey();
    let counter = 0;
    const bus = new ValkeyStreamBus(v, 's', {
      service: 'asr',
      instance: 'h1',
      version: '0.1.0',
      nowIso: () => '2026-04-23T00:00:00Z',
      nextId: () => `evt-${++counter}`,
      currentTrace: () => ({ trace_id: 't', span_id: 's' }),
    });
    const id = await bus.publish('asr.member.activated', 'ctn', { x: 1 });
    expect(id).toBe('evt-1');

    const consumer = new ValkeyStreamConsumer(v, 's', 'g', 'c');
    await consumer.ensureGroup();
    // ensureGroup was called after publish so lastDeliveredId is already at the latest entry.
    // Publish another one now that the group exists.
    await bus.publish('asr.member.activated', 'ctn', { x: 2 });
    const polled = await consumer.poll(10);
    expect(polled).toHaveLength(1);
    await consumer.ack(polled[0]!.id);
    expect(await consumer.pending()).toHaveLength(0);
  });

  test('ValkeyStreamSink with maxLen does not throw', async () => {
    const v = new InMemoryValkey();
    const sink = new ValkeyStreamSink(v, 's', 1);
    const env: EventEnvelope = {
      id: 'e',
      occurred_at: 'now',
      producer: { service: 'asr', instance: 'h', version: '0' },
      association_id: 'ctn',
      type: 't',
      schema_version: 1,
      trace: { trace_id: 't', span_id: 's' },
      body: {},
    };
    await sink.write(env);
    await sink.write(env);
  });
});

describe('ValkeyTokenBucket', () => {
  test('allows up to limit, rejects beyond', async () => {
    const v = new InMemoryValkey();
    const rl = new ValkeyTokenBucket(v, { limit: 2, windowMs: 60_000, prefix: 'rl:' });
    expect(await rl.allow('user-a')).toBe(true);
    expect(await rl.allow('user-a')).toBe(true);
    expect(await rl.allow('user-a')).toBe(false);
    expect(await rl.allow('user-b')).toBe(true);
  });
});

describe('ValkeyLock', () => {
  test('acquire + release with correct token', async () => {
    const v = new InMemoryValkey();
    const l = new ValkeyLock(v);
    const token = await l.acquire('lock:x', 60_000);
    expect(token).not.toBeNull();
    expect(await l.acquire('lock:x', 60_000)).toBeNull();
    expect(await l.release('lock:x', token!)).toBe(true);
    expect(await l.release('lock:x', 'bogus')).toBe(false);
  });

  test('release with wrong token does nothing', async () => {
    const v = new InMemoryValkey();
    const l = new ValkeyLock(v);
    await l.acquire('lock:x', 60_000);
    expect(await l.release('lock:x', 'wrong')).toBe(false);
  });
});
