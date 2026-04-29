// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { brandValue, type Brand } from '../src/branded.ts';

describe('branded', () => {
  test('brandValue tags value at type level (runtime identity)', () => {
    type Ticker = Brand<string, 'Ticker'>;
    const t = brandValue<string, 'Ticker'>('AAPL') as Ticker;
    expect(t).toBe('AAPL');
  });
});
