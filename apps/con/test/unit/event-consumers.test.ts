// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import type { EventEnvelope } from '@bdi/contracts';
import {
  InMemoryBvodCache,
  InMemoryMemberCache,
  buildAsrEventConsumer,
  buildOrsEventConsumer,
} from '../../src/interface/events/consumers.ts';
import { TrustlistStore } from '../../src/infrastructure/trustlist-store.ts';
import { InMemoryTrustlist } from '@bdi/crypto';

function env<T>(type: string, body: T): EventEnvelope<T> {
  return {
    id: 'e',
    occurred_at: 'now',
    producer: { service: 'asr', instance: 'h', version: '0' },
    association_id: 'ctn',
    type,
    schema_version: 1,
    trace: { trace_id: 't', span_id: 's' },
    body,
  };
}

function buildDeps() {
  const trustlist = new TrustlistStore(new InMemoryTrustlist());
  const bvodCache = new InMemoryBvodCache();
  const memberCache = new InMemoryMemberCache();
  return { trustlist, bvodCache, memberCache, ownMemberEuid: 'NL.NHR.1' };
}

describe('ASR event consumer', () => {
  test('asr.member.activated refreshes trustlist', async () => {
    const deps = buildDeps();
    const c = buildAsrEventConsumer(deps);
    let refreshed = 0;
    deps.trustlist.refresh = async () => {
      refreshed += 1;
    };
    c.submit(env('asr.member.activated', {}));
    const r = await c.tick();
    expect(r?.action).toBe('ack');
    expect(refreshed).toBe(1);
  });

  test('asr.member.suspended invalidates member cache and refreshes', async () => {
    const deps = buildDeps();
    const c = buildAsrEventConsumer(deps);
    c.submit(env('asr.member.suspended', { euid: 'NL.NHR.1' }));
    await c.tick();
    expect(deps.memberCache.invalidated.has('NL.NHR.1')).toBe(true);
  });

  test('asr.member.revoked invalidates member cache', async () => {
    const deps = buildDeps();
    const c = buildAsrEventConsumer(deps);
    c.submit(env('asr.member.revoked', { euid: 'NL.NHR.1' }));
    await c.tick();
    expect(deps.memberCache.invalidated.has('NL.NHR.1')).toBe(true);
  });

  test('asr.keys.rotated triggers refresh', async () => {
    const deps = buildDeps();
    const c = buildAsrEventConsumer(deps);
    let refreshed = 0;
    deps.trustlist.refresh = async () => {
      refreshed += 1;
    };
    c.submit(env('asr.keys.rotated', {}));
    c.submit(env('asr.trustlist.updated', {}));
    c.submit(env('asr.certificate.revoked', { serial: 'x' }));
    await c.tick();
    await c.tick();
    await c.tick();
    expect(refreshed).toBe(3);
  });

  test('unknown event is acked silently', async () => {
    const deps = buildDeps();
    const c = buildAsrEventConsumer(deps);
    c.submit(env('asr.future.whatever', {}));
    const r = await c.tick();
    expect(r?.action).toBe('ack');
  });
});

describe('ORS event consumer', () => {
  test('warms BVOD cache when own member added', async () => {
    const deps = buildDeps();
    const c = buildOrsEventConsumer(deps);
    c.submit(env('ors.context.party-added', { chain_context_id: 'x', member_euid: 'NL.NHR.1' }));
    await c.tick();
    expect(deps.bvodCache.warmed.has('x')).toBe(true);
  });

  test('does not warm when different org added', async () => {
    const deps = buildDeps();
    const c = buildOrsEventConsumer(deps);
    c.submit(env('ors.context.party-added', { chain_context_id: 'x', member_euid: 'NL.NHR.2' }));
    await c.tick();
    expect(deps.bvodCache.warmed.has('x')).toBe(false);
  });

  test('invalidates BVOD cache when party removed', async () => {
    const deps = buildDeps();
    const c = buildOrsEventConsumer(deps);
    c.submit(env('ors.context.party-removed', { chain_context_id: 'x' }));
    await c.tick();
    expect(deps.bvodCache.invalidated.has('x')).toBe(true);
  });

  test('invalidates on completion/cancellation', async () => {
    const deps = buildDeps();
    const c = buildOrsEventConsumer(deps);
    c.submit(env('ors.context.completed', { chain_context_id: 'y' }));
    c.submit(env('ors.context.cancelled', { chain_context_id: 'z' }));
    await c.tick();
    await c.tick();
    expect(deps.bvodCache.invalidated.has('y')).toBe(true);
    expect(deps.bvodCache.invalidated.has('z')).toBe(true);
  });

  test('unknown event acked silently', async () => {
    const deps = buildDeps();
    const c = buildOrsEventConsumer(deps);
    c.submit(env('ors.future.thing', {}));
    const r = await c.tick();
    expect(r?.action).toBe('ack');
  });
});

describe('In-memory caches', () => {
  test('BvodCache warm/invalidate mutual exclusion', () => {
    const c = new InMemoryBvodCache();
    c.warm('x');
    expect(c.warmed.has('x')).toBe(true);
    c.invalidate('x');
    expect(c.warmed.has('x')).toBe(false);
    expect(c.invalidated.has('x')).toBe(true);
    c.warm('x');
    expect(c.invalidated.has('x')).toBe(false);
  });

  test('MemberCache records invalidations', () => {
    const c = new InMemoryMemberCache();
    c.invalidate('NL.NHR.1');
    c.invalidate('NL.NHR.2');
    expect(c.invalidated.size).toBe(2);
  });
});
