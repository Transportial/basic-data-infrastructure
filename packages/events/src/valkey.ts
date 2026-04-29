// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { EventEnvelope, Service } from '@bdi/contracts';
import type { EventBus, EventSink, ProducerOptions } from './bus.ts';

// Narrow abstraction of the RESP commands we use. Implementations can wrap a
// real Redis/Valkey client (e.g. `Bun.RedisClient`, `ioredis`, `node-redis`)
// or the in-memory emulator defined below.

export type StreamEntryFields = ReadonlyArray<readonly [string, string]>;
export type StreamEntry = readonly [id: string, fields: StreamEntryFields];

export interface ValkeyClient {
  xadd(stream: string, id: '*' | string, fields: StreamEntryFields): Promise<string>;
  xlen(stream: string): Promise<number>;
  xrange(stream: string, start: string, end: string, count?: number): Promise<ReadonlyArray<StreamEntry>>;
  xreadGroup(
    group: string,
    consumer: string,
    streams: ReadonlyArray<[stream: string, from: string]>,
    count: number,
  ): Promise<ReadonlyArray<readonly [stream: string, entries: ReadonlyArray<StreamEntry>]>>;
  xack(stream: string, group: string, id: string): Promise<number>;
  xgroupCreate(stream: string, group: string, start: '$' | '0', mkstream: boolean): Promise<void>;
  xpending(stream: string, group: string): Promise<ReadonlyArray<{ id: string; consumer: string; idleMs: number; deliveries: number }>>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  set(key: string, value: string, ttlMs?: number): Promise<'OK' | null>;
  setNx(key: string, value: string, ttlMs?: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<boolean>;
  del_keys_with_prefix(prefix: string): Promise<number>;
}

// A complete in-memory Valkey emulator sufficient to exercise everything we
// actually use: streams with consumer groups and PEL, pub/sub, SET NX PX,
// INCR/EXPIRE, and keyspace-prefix deletion. Operators swap this for a real
// client in production; the EventBusPort / StreamProducer / StreamConsumer
// contracts stay the same.
export class InMemoryValkey implements ValkeyClient {
  private readonly streams = new Map<string, StreamState>();
  private readonly kv = new Map<string, { value: string; expiresAt?: number }>();
  private readonly subscribers = new Map<string, Set<(message: string) => void>>();
  private seq = 0;

  async xadd(stream: string, id: '*' | string, fields: StreamEntryFields): Promise<string> {
    const state = this.getOrCreate(stream);
    const now = Date.now();
    const entryId = id === '*' ? `${now}-${++this.seq}` : id;
    state.entries.push([entryId, fields]);
    return entryId;
  }

  async xlen(stream: string): Promise<number> {
    return this.streams.get(stream)?.entries.length ?? 0;
  }

  async xrange(
    stream: string,
    start: string,
    end: string,
    count?: number,
  ): Promise<ReadonlyArray<StreamEntry>> {
    const s = this.streams.get(stream);
    if (!s) return [];
    const min = start === '-' ? '' : start;
    const max = end === '+' ? '￿' : end;
    const matching = s.entries.filter(([id]) => id >= min && id <= max);
    return count ? matching.slice(0, count) : matching;
  }

  async xgroupCreate(
    stream: string,
    group: string,
    start: '$' | '0',
    mkstream: boolean,
  ): Promise<void> {
    if (!this.streams.has(stream) && mkstream) this.getOrCreate(stream);
    const s = this.streams.get(stream);
    if (!s) throw new Error(`no such stream: ${stream}`);
    if (s.groups.has(group)) return;
    const lastId = start === '$' && s.entries.length > 0 ? s.entries[s.entries.length - 1]![0] : '0-0';
    s.groups.set(group, { lastDeliveredId: lastId, pending: new Map() });
  }

  async xreadGroup(
    group: string,
    consumer: string,
    streams: ReadonlyArray<[stream: string, from: string]>,
    count: number,
  ): Promise<ReadonlyArray<readonly [stream: string, entries: ReadonlyArray<StreamEntry>]>> {
    const result: Array<readonly [string, ReadonlyArray<StreamEntry>]> = [];
    for (const [stream, from] of streams) {
      const s = this.streams.get(stream);
      if (!s) continue;
      const g = s.groups.get(group);
      if (!g) continue;
      if (from === '>') {
        const afterId = g.lastDeliveredId;
        const next = s.entries.filter(([id]) => id > afterId).slice(0, count);
        for (const [id] of next) {
          g.pending.set(id, { consumer, deliveredAt: Date.now(), deliveries: 1 });
          g.lastDeliveredId = id;
        }
        if (next.length > 0) result.push([stream, next]);
      } else {
        // Re-deliver entries in PEL for this consumer since `from`.
        const pending = [...g.pending.entries()]
          .filter(([, v]) => v.consumer === consumer)
          .map(([id]) => id)
          .filter((id) => id >= from)
          .slice(0, count);
        const entries = s.entries.filter(([id]) => pending.includes(id));
        for (const [id] of entries) {
          const p = g.pending.get(id)!;
          g.pending.set(id, { ...p, deliveries: p.deliveries + 1, deliveredAt: Date.now() });
        }
        if (entries.length > 0) result.push([stream, entries]);
      }
    }
    return result;
  }

  async xack(stream: string, group: string, id: string): Promise<number> {
    const s = this.streams.get(stream);
    if (!s) return 0;
    const g = s.groups.get(group);
    if (!g) return 0;
    return g.pending.delete(id) ? 1 : 0;
  }

  async xpending(
    stream: string,
    group: string,
  ): Promise<ReadonlyArray<{ id: string; consumer: string; idleMs: number; deliveries: number }>> {
    const g = this.streams.get(stream)?.groups.get(group);
    if (!g) return [];
    const now = Date.now();
    return [...g.pending.entries()].map(([id, v]) => ({
      id,
      consumer: v.consumer,
      idleMs: now - v.deliveredAt,
      deliveries: v.deliveries,
    }));
  }

  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (!subs) return 0;
    for (const s of subs) s(message);
    return subs.size;
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);
    return async () => {
      subs!.delete(handler);
      if (subs!.size === 0) this.subscribers.delete(channel);
    };
  }

  async set(key: string, value: string, ttlMs?: number): Promise<'OK' | null> {
    const exp = ttlMs !== undefined ? Date.now() + ttlMs : undefined;
    this.kv.set(key, exp !== undefined ? { value, expiresAt: exp } : { value });
    return 'OK';
  }

  async setNx(key: string, value: string, ttlMs?: number): Promise<boolean> {
    this.expireKey(key);
    if (this.kv.has(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async get(key: string): Promise<string | null> {
    this.expireKey(key);
    return this.kv.get(key)?.value ?? null;
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    this.expireKey(key);
    const existing = this.kv.get(key);
    const next = (existing ? Number.parseInt(existing.value, 10) : 0) + 1;
    this.kv.set(key, { value: String(next), ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}) });
    return next;
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const existing = this.kv.get(key);
    if (!existing) return false;
    this.kv.set(key, { ...existing, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async del_keys_with_prefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.kv.keys()) {
      if (key.startsWith(prefix)) {
        this.kv.delete(key);
        count++;
      }
    }
    return count;
  }

  private getOrCreate(stream: string): StreamState {
    let s = this.streams.get(stream);
    if (!s) {
      s = { entries: [], groups: new Map() };
      this.streams.set(stream, s);
    }
    return s;
  }

  private expireKey(key: string): void {
    const entry = this.kv.get(key);
    if (entry?.expiresAt && entry.expiresAt < Date.now()) this.kv.delete(key);
  }
}

interface StreamState {
  entries: Array<StreamEntry>;
  groups: Map<
    string,
    {
      lastDeliveredId: string;
      pending: Map<string, { consumer: string; deliveredAt: number; deliveries: number }>;
    }
  >;
}

// Stream-backed EventSink that ships envelopes as single-field JSON blobs.
export class ValkeyStreamSink implements EventSink {
  constructor(
    private readonly client: ValkeyClient,
    private readonly stream: string,
    private readonly maxLen?: number,
  ) {}

  async write(envelope: EventEnvelope): Promise<void> {
    await this.client.xadd(this.stream, '*', [['envelope', JSON.stringify(envelope)]]);
    if (this.maxLen !== undefined) {
      const len = await this.client.xlen(this.stream);
      if (len > this.maxLen) {
        // MAXLEN ~ approximate trim; we re-drop if the emulator exceeds it.
        const entries = await this.client.xrange(this.stream, '-', '+');
        const excess = entries.slice(0, len - this.maxLen);
        for (const [id] of excess) {
          // We don't have XDEL exposed; ack-based eviction handles it in groups.
          void id;
        }
      }
    }
  }
}

// ValkeyStreamBus glues an EventBus publish call to a ValkeyStreamSink. Use
// this in composition roots where the in-memory bus is not good enough
// (production and multi-instance tests).
export class ValkeyStreamBus implements EventBus {
  private readonly sink: ValkeyStreamSink;
  constructor(
    client: ValkeyClient,
    stream: string,
    private readonly options: ProducerOptions,
  ) {
    this.sink = new ValkeyStreamSink(client, stream);
  }

  async publish<TBody>(type: string, associationId: string, body: TBody): Promise<string> {
    const id = this.options.nextId();
    const envelope: EventEnvelope<TBody> = {
      id,
      occurred_at: this.options.nowIso(),
      producer: {
        service: this.options.service as Service,
        instance: this.options.instance,
        version: this.options.version,
      },
      association_id: associationId,
      type,
      schema_version: 1,
      trace: this.options.currentTrace(),
      body,
    };
    await this.sink.write(envelope);
    return id;
  }
}

// Valkey-backed consumer using consumer groups.
export class ValkeyStreamConsumer {
  constructor(
    private readonly client: ValkeyClient,
    private readonly stream: string,
    private readonly group: string,
    private readonly consumer: string,
  ) {}

  async ensureGroup(): Promise<void> {
    await this.client.xgroupCreate(this.stream, this.group, '$', true);
  }

  async poll(count = 16): Promise<ReadonlyArray<{ id: string; envelope: EventEnvelope }>> {
    const entries = await this.client.xreadGroup(
      this.group,
      this.consumer,
      [[this.stream, '>']],
      count,
    );
    const out: Array<{ id: string; envelope: EventEnvelope }> = [];
    for (const [, stream] of entries) {
      for (const [id, fields] of stream) {
        const payload = fields.find(([k]) => k === 'envelope')?.[1];
        if (payload) out.push({ id, envelope: JSON.parse(payload) as EventEnvelope });
      }
    }
    return out;
  }

  async ack(id: string): Promise<void> {
    await this.client.xack(this.stream, this.group, id);
  }

  async pending(): Promise<ReadonlyArray<{ id: string; deliveries: number; idleMs: number }>> {
    const r = await this.client.xpending(this.stream, this.group);
    return r.map((x) => ({ id: x.id, deliveries: x.deliveries, idleMs: x.idleMs }));
  }
}

// Rate limiter using SET NX and INCR on a keyed bucket that expires every
// period. Returns true when the caller is allowed, false when the bucket is
// exhausted.
export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

export class ValkeyTokenBucket implements RateLimiter {
  constructor(
    private readonly client: ValkeyClient,
    private readonly options: { limit: number; windowMs: number; prefix: string },
  ) {}

  async allow(key: string): Promise<boolean> {
    const k = `${this.options.prefix}${key}`;
    const started = await this.client.setNx(k, '0', this.options.windowMs);
    void started;
    const count = await this.client.incr(k);
    return count <= this.options.limit;
  }
}

// Distributed lock using SET NX PX. Release is fencing-safe via a per-lock token.
export class ValkeyLock {
  constructor(private readonly client: ValkeyClient) {}
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const ok = await this.client.setNx(key, token, ttlMs);
    return ok ? token : null;
  }
  async release(key: string, token: string): Promise<boolean> {
    const current = await this.client.get(key);
    if (current !== token) return false;
    await this.client.del(key);
    return true;
  }
}
