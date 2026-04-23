// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  DeterministicIds,
  DeterministicUuidGenerator,
} from '../src/deterministic-id.ts';
import { FakeEventBus } from '../src/fake-event-bus.ts';
import { FakeSigner } from '../src/fake-signer.ts';

describe('DeterministicIds', () => {
  test('generates sequential ids with default prefix', () => {
    const g = new DeterministicIds();
    expect(g.next()).toBe('id-1');
    expect(g.next()).toBe('id-2');
  });

  test('accepts custom prefix', () => {
    const g = new DeterministicIds('member');
    expect(g.next()).toBe('member-1');
  });

  test('reset rewinds counter', () => {
    const g = new DeterministicIds();
    g.next();
    g.next();
    g.reset();
    expect(g.next()).toBe('id-1');
  });
});

describe('DeterministicUuidGenerator', () => {
  test('generates v4-looking UUIDs', () => {
    const g = new DeterministicUuidGenerator();
    expect(g.next()).toBe('00000000-0000-4000-8000-000000000001');
    expect(g.next()).toBe('00000000-0000-4000-8000-000000000002');
  });

  test('reset', () => {
    const g = new DeterministicUuidGenerator();
    g.next();
    g.reset();
    expect(g.next()).toBe('00000000-0000-4000-8000-000000000001');
  });
});

describe('FakeEventBus', () => {
  test('records published events', async () => {
    const bus = new FakeEventBus();
    await bus.publish('asr.member.activated', 'ctn', { euid: 'NL.NHR.1' });
    await bus.publish('asr.member.suspended', 'ctn', { euid: 'NL.NHR.2' });
    expect(bus.events).toHaveLength(2);
  });

  test('findAllOfType filters', async () => {
    const bus = new FakeEventBus();
    await bus.publish('a', 'c', {});
    await bus.publish('b', 'c', {});
    await bus.publish('a', 'c', {});
    expect(bus.findAllOfType('a')).toHaveLength(2);
  });

  test('lastOfType returns latest or undefined', async () => {
    const bus = new FakeEventBus();
    expect(bus.lastOfType('a')).toBeUndefined();
    await bus.publish('a', 'c', { n: 1 });
    await bus.publish('a', 'c', { n: 2 });
    expect(bus.lastOfType('a')?.body).toEqual({ n: 2 });
  });

  test('clear empties events', async () => {
    const bus = new FakeEventBus();
    await bus.publish('a', 'c', {});
    bus.clear();
    expect(bus.events).toHaveLength(0);
  });
});

describe('FakeSigner', () => {
  test('signs and verifies round-trip', async () => {
    const s = new FakeSigner('k1');
    const jwt = await s.signJwt({ iss: 'asr', sub: 'x' });
    expect(jwt.split('.')).toHaveLength(3);
    const verified = await s.verifyJwt(jwt);
    expect(verified).toEqual({ iss: 'asr', sub: 'x' });
  });

  test('rejects malformed compact', async () => {
    const s = new FakeSigner();
    await expect(s.verifyJwt('just-a-string')).rejects.toThrow();
  });

  test('rejects foreign signature', async () => {
    const s = new FakeSigner();
    const bad = 'aGVhZGVy.cGF5bG9hZA.real-signature';
    await expect(s.verifyJwt(bad)).rejects.toThrow();
  });

  test('exposes kid', () => {
    const s = new FakeSigner('my-kid');
    expect(s.kid).toBe('my-kid');
  });
});
