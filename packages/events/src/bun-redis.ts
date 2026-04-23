// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { StreamEntry, StreamEntryFields, ValkeyClient } from './valkey.ts';

// Narrow shape of the native Bun RedisClient we use. Keeping this interface
// minimal means any `ioredis`-compatible client can be slotted in by wrapping
// it in an adapter; operators on a pre-Bun-1.3 runtime swap in their own.
export interface NativeRedisClient {
  connect?(): Promise<void>;
  send(command: string, args: ReadonlyArray<string>): Promise<unknown>;
  subscribe(
    channel: string,
    handler: (message: string, channel: string) => void,
  ): Promise<void> | void;
  unsubscribe?(channel: string): Promise<void> | void;
}

export interface BunRedisValkeyOptions {
  readonly client: NativeRedisClient;
  readonly pubsubClient?: NativeRedisClient;
}

// Real Valkey/Redis adapter implementing our ValkeyClient interface on top of
// a RESP-speaking client. The surface maps 1:1 with the commands we use:
// XADD, XLEN, XRANGE, XREADGROUP, XACK, XGROUP CREATE, XPENDING,
// SET / GET / DEL / INCR / EXPIRE / SCAN, and PUBLISH / SUBSCRIBE.
export class BunRedisValkey implements ValkeyClient {
  constructor(private readonly options: BunRedisValkeyOptions) {}

  async xadd(stream: string, id: '*' | string, fields: StreamEntryFields): Promise<string> {
    const args = [stream, id];
    for (const [k, v] of fields) args.push(k, v);
    const raw = await this.options.client.send('XADD', args);
    return String(raw);
  }

  async xlen(stream: string): Promise<number> {
    return Number(await this.options.client.send('XLEN', [stream]));
  }

  async xrange(
    stream: string,
    start: string,
    end: string,
    count?: number,
  ): Promise<ReadonlyArray<StreamEntry>> {
    const args = [stream, start, end];
    if (count !== undefined) args.push('COUNT', String(count));
    const raw = (await this.options.client.send('XRANGE', args)) as Array<[string, string[]]>;
    return raw.map(([id, flat]) => [id, pairs(flat)] as StreamEntry);
  }

  async xreadGroup(
    group: string,
    consumer: string,
    streams: ReadonlyArray<[stream: string, from: string]>,
    count: number,
  ): Promise<ReadonlyArray<readonly [stream: string, entries: ReadonlyArray<StreamEntry>]>> {
    const args = ['GROUP', group, consumer, 'COUNT', String(count), 'STREAMS'];
    for (const [s] of streams) args.push(s);
    for (const [, f] of streams) args.push(f);
    const raw = (await this.options.client.send('XREADGROUP', args)) as
      | Array<[string, Array<[string, string[]]>]>
      | null;
    if (!raw) return [];
    return raw.map(
      ([s, entries]) =>
        [s, entries.map(([id, flat]) => [id, pairs(flat)] as StreamEntry)] as readonly [
          string,
          ReadonlyArray<StreamEntry>,
        ],
    );
  }

  async xack(stream: string, group: string, id: string): Promise<number> {
    return Number(await this.options.client.send('XACK', [stream, group, id]));
  }

  async xgroupCreate(
    stream: string,
    group: string,
    start: '$' | '0',
    mkstream: boolean,
  ): Promise<void> {
    const args = ['CREATE', stream, group, start];
    if (mkstream) args.push('MKSTREAM');
    try {
      await this.options.client.send('XGROUP', args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // BUSYGROUP means the group already exists — harmless.
      if (!msg.includes('BUSYGROUP')) throw e;
    }
  }

  async xpending(
    stream: string,
    group: string,
  ): Promise<ReadonlyArray<{ id: string; consumer: string; idleMs: number; deliveries: number }>> {
    const raw = (await this.options.client.send('XPENDING', [stream, group, '-', '+', '100'])) as Array<
      [string, string, number, number]
    >;
    return raw.map(([id, consumer, idleMs, deliveries]) => ({
      id,
      consumer,
      idleMs,
      deliveries,
    }));
  }

  async publish(channel: string, message: string): Promise<number> {
    return Number(await this.options.client.send('PUBLISH', [channel, message]));
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const sub = this.options.pubsubClient ?? this.options.client;
    await sub.subscribe(channel, (message) => handler(message));
    return async () => {
      await sub.unsubscribe?.(channel);
    };
  }

  async set(key: string, value: string, ttlMs?: number): Promise<'OK' | null> {
    const args = [key, value];
    if (ttlMs !== undefined) args.push('PX', String(ttlMs));
    const raw = await this.options.client.send('SET', args);
    return raw === 'OK' ? 'OK' : null;
  }

  async setNx(key: string, value: string, ttlMs?: number): Promise<boolean> {
    const args = [key, value, 'NX'];
    if (ttlMs !== undefined) args.push('PX', String(ttlMs));
    const raw = await this.options.client.send('SET', args);
    return raw === 'OK';
  }

  async get(key: string): Promise<string | null> {
    const raw = await this.options.client.send('GET', [key]);
    return raw === null || raw === undefined ? null : String(raw);
  }

  async del(key: string): Promise<number> {
    return Number(await this.options.client.send('DEL', [key]));
  }

  async incr(key: string): Promise<number> {
    return Number(await this.options.client.send('INCR', [key]));
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const raw = await this.options.client.send('PEXPIRE', [key, String(ttlMs)]);
    return Number(raw) === 1;
  }

  async del_keys_with_prefix(prefix: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const result = (await this.options.client.send('SCAN', [
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        '500',
      ])) as [string, string[]];
      cursor = result[0];
      const batch = result[1];
      if (batch.length > 0) {
        deleted += Number(await this.options.client.send('DEL', batch));
      }
    } while (cursor !== '0');
    return deleted;
  }
}

function pairs(flat: ReadonlyArray<string>): StreamEntryFields {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([flat[i]!, flat[i + 1] ?? '']);
  }
  return out;
}

// Tiny in-process fake of a NativeRedisClient: supports enough RESP-level
// semantics for the adapter's unit tests without requiring a running Redis.
export class FakeNativeRedisClient implements NativeRedisClient {
  readonly commands: Array<{ cmd: string; args: ReadonlyArray<string> }> = [];
  private readonly responses: Array<(cmd: string, args: ReadonlyArray<string>) => unknown>;
  private readonly subs = new Map<string, (message: string, channel: string) => void>();

  constructor(responses: Array<(cmd: string, args: ReadonlyArray<string>) => unknown> = []) {
    this.responses = responses;
  }

  push(handler: (cmd: string, args: ReadonlyArray<string>) => unknown): void {
    this.responses.push(handler);
  }

  async send(command: string, args: ReadonlyArray<string>): Promise<unknown> {
    this.commands.push({ cmd: command, args });
    const handler = this.responses.shift();
    if (!handler) throw new Error(`no response queued for ${command}`);
    return handler(command, args);
  }

  async subscribe(
    channel: string,
    handler: (message: string, channel: string) => void,
  ): Promise<void> {
    this.subs.set(channel, handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subs.delete(channel);
  }

  deliver(channel: string, message: string): void {
    this.subs.get(channel)?.(message, channel);
  }
}
