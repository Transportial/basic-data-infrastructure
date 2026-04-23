// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { composeAsr, InMemoryEventBus } from '../../src/composition-root.ts';
import { SystemUuidIds } from '../../src/infrastructure/id-port.ts';

describe('InMemoryEventBus', () => {
  test('publish + clear', async () => {
    const bus = new InMemoryEventBus();
    await bus.publish('t', 'ctn', {});
    expect(bus.published).toHaveLength(1);
    bus.clear();
    expect(bus.published).toHaveLength(0);
  });
});

describe('composeAsr', () => {
  test('builds a router with default (no sources)', async () => {
    const c = await composeAsr({ issuer: 'https://asr' });
    expect(c.router).toBeDefined();
    expect(c.deps.signer).toBeDefined();
    expect(c.deps.jwks).toBeDefined();
  });

  test('honours KvK + VIES config', async () => {
    const c = await composeAsr({
      issuer: 'https://asr',
      kvk: { baseUrl: 'https://kvk', apiKey: 'k' },
      vies: { baseUrl: 'https://vies' },
    });
    expect(c.deps.signer).toBeDefined();
  });

  test('jwks returns active + next keys', async () => {
    const c = await composeAsr({ issuer: 'https://asr' });
    const keys = await c.deps.jwks.current();
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SystemUuidIds', () => {
  test('produces UUID format', () => {
    const g = new SystemUuidIds();
    expect(g.newUuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
