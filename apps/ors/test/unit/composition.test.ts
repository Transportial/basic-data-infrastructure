// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { composeOrs, InMemoryEventBus } from '../../src/composition-root.ts';

describe('ORS InMemoryEventBus', () => {
  test('publish + clear', async () => {
    const bus = new InMemoryEventBus();
    await bus.publish('t', 'ctn', {});
    expect(bus.published).toHaveLength(1);
    bus.clear();
    expect(bus.published).toHaveLength(0);
  });
});

describe('composeOrs', () => {
  test('builds a router with provided signing key', () => {
    const c = composeOrs({
      issuer: 'https://ors',
      signingKid: 'my-ors',
      signingKey: new Uint8Array(32),
    });
    expect(c.deps.signer.kid).toBe('my-ors');
  });
});
