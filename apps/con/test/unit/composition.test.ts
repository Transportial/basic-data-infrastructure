// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { composeCon, InMemoryEventBus } from '../../src/composition-root.ts';

describe('CON InMemoryEventBus', () => {
  test('publish + clear', async () => {
    const bus = new InMemoryEventBus();
    await bus.publish('t', 'ctn', {});
    expect(bus.published).toHaveLength(1);
    bus.clear();
    expect(bus.published).toHaveLength(0);
  });
});

describe('composeCon', () => {
  test('uses default policies when none provided', () => {
    const c = composeCon({
      asrIssuer: 'https://asr',
      orsIssuer: 'https://ors',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
    });
    expect(c.router).toBeDefined();
  });

  test('honours custom policy set', () => {
    const c = composeCon({
      asrIssuer: 'https://asr',
      orsIssuer: 'https://ors',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
      policies: [{ id: 'mine', effect: 'permit', actions: '*' }],
    });
    expect(c.router).toBeDefined();
  });
});
