// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { BunRedisValkey, FakeNativeRedisClient } from '../src/bun-redis.ts';

function mk(responses: Array<(cmd: string, args: ReadonlyArray<string>) => unknown>) {
  const native = new FakeNativeRedisClient(responses);
  const client = new BunRedisValkey({ client: native });
  return { native, client };
}

describe('BunRedisValkey', () => {
  test('xadd sends proper args', async () => {
    const { native, client } = mk([(_, a) => a[1]!]);
    const id = await client.xadd('s', '*', [
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(id).toBe('*');
    expect(native.commands[0]).toEqual({ cmd: 'XADD', args: ['s', '*', 'a', '1', 'b', '2'] });
  });

  test('xlen casts to number', async () => {
    const { client } = mk([() => '5']);
    expect(await client.xlen('s')).toBe(5);
  });

  test('xrange maps flat fields to pairs', async () => {
    const { client } = mk([
      () => [
        ['1-0', ['k', 'v', 'm', 'n']],
        ['2-0', ['a', 'b']],
      ],
    ]);
    const r = await client.xrange('s', '-', '+', 10);
    expect(r).toHaveLength(2);
    expect(r[0]?.[1]).toEqual([['k', 'v'], ['m', 'n']]);
  });

  test('xreadGroup null returns empty', async () => {
    const { client } = mk([() => null]);
    const r = await client.xreadGroup('g', 'c', [['s', '>']], 10);
    expect(r).toHaveLength(0);
  });

  test('xreadGroup maps nested structure', async () => {
    const { client } = mk([
      () => [
        [
          's',
          [
            ['1-0', ['k', 'v']],
            ['2-0', ['a', 'b']],
          ],
        ],
      ],
    ]);
    const r = await client.xreadGroup('g', 'c', [['s', '>']], 10);
    expect(r[0]?.[0]).toBe('s');
    expect(r[0]?.[1][0]?.[1]).toEqual([['k', 'v']]);
  });

  test('xack casts', async () => {
    const { client } = mk([() => '1']);
    expect(await client.xack('s', 'g', 'id')).toBe(1);
  });

  test('xgroupCreate passes MKSTREAM', async () => {
    const { native, client } = mk([() => 'OK']);
    await client.xgroupCreate('s', 'g', '$', true);
    expect(native.commands[0]?.args).toContain('MKSTREAM');
  });

  test('xgroupCreate swallows BUSYGROUP', async () => {
    const { client } = mk([
      () => {
        throw new Error('BUSYGROUP Consumer Group name already exists');
      },
    ]);
    await client.xgroupCreate('s', 'g', '$', false);
  });

  test('xgroupCreate rethrows other errors', async () => {
    const { client } = mk([
      () => {
        throw new Error('WRONGTYPE');
      },
    ]);
    await expect(client.xgroupCreate('s', 'g', '$', false)).rejects.toThrow();
  });

  test('xpending maps to objects', async () => {
    const { client } = mk([
      () => [
        ['1-0', 'c1', 100, 3],
        ['2-0', 'c2', 200, 1],
      ],
    ]);
    const r = await client.xpending('s', 'g');
    expect(r).toHaveLength(2);
    expect(r[0]?.deliveries).toBe(3);
  });

  test('publish + subscribe via pubsub client', async () => {
    const { client, native } = mk([() => 1]);
    expect(await client.publish('ch', 'hi')).toBe(1);
    expect(native.commands[0]?.cmd).toBe('PUBLISH');

    const received: string[] = [];
    const unsub = await client.subscribe('ch', (msg) => received.push(msg));
    native.deliver('ch', 'hello');
    expect(received).toEqual(['hello']);
    await unsub();
  });

  test('set + get + del', async () => {
    const { native, client } = mk([() => 'OK', () => 'v', () => '1']);
    expect(await client.set('k', 'v')).toBe('OK');
    expect(await client.get('k')).toBe('v');
    expect(await client.del('k')).toBe(1);
    expect(native.commands[0]?.args).toEqual(['k', 'v']);
  });

  test('set with ttl includes PX', async () => {
    const { native, client } = mk([() => 'OK']);
    await client.set('k', 'v', 500);
    expect(native.commands[0]?.args).toEqual(['k', 'v', 'PX', '500']);
  });

  test('set returns null on non-OK response', async () => {
    const { client } = mk([() => null]);
    expect(await client.set('k', 'v')).toBeNull();
  });

  test('setNx returns true on OK, false otherwise', async () => {
    const { client } = mk([() => 'OK', () => null]);
    expect(await client.setNx('k', 'v')).toBe(true);
    expect(await client.setNx('k', 'v')).toBe(false);
  });

  test('get returns null for missing key', async () => {
    const { client } = mk([() => null]);
    expect(await client.get('missing')).toBeNull();
  });

  test('incr returns number', async () => {
    const { client } = mk([() => '3']);
    expect(await client.incr('k')).toBe(3);
  });

  test('expire returns boolean', async () => {
    const { client } = mk([() => '1', () => '0']);
    expect(await client.expire('k', 100)).toBe(true);
    expect(await client.expire('missing', 100)).toBe(false);
  });

  test('del_keys_with_prefix loops through SCAN', async () => {
    const { client, native } = mk([
      () => ['1', ['a:1', 'a:2']],
      () => '2',
      () => ['0', ['a:3']],
      () => '1',
    ]);
    expect(await client.del_keys_with_prefix('a:')).toBe(3);
    expect(native.commands[0]?.cmd).toBe('SCAN');
  });

  test('del_keys_with_prefix short-circuits empty batch', async () => {
    const { client } = mk([() => ['0', []]]);
    expect(await client.del_keys_with_prefix('a:')).toBe(0);
  });
});

describe('FakeNativeRedisClient', () => {
  test('throws when no response queued', async () => {
    const fake = new FakeNativeRedisClient();
    await expect(fake.send('PING', [])).rejects.toThrow();
  });

  test('push queues additional responses', async () => {
    const fake = new FakeNativeRedisClient();
    fake.push(() => 'first');
    fake.push(() => 'second');
    expect(await fake.send('X', [])).toBe('first');
    expect(await fake.send('X', [])).toBe('second');
  });
});
