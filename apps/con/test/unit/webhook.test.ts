// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  classifyResponse,
  DEFAULT_RETRY_POLICY,
  nextBackoffMs,
} from '../../src/domain/webhook.ts';

describe('nextBackoffMs', () => {
  test('initial attempt starts at initialBackoff', () => {
    const ms = nextBackoffMs(
      { ...DEFAULT_RETRY_POLICY, jitter: 0 },
      1,
      () => 0.5,
    );
    expect(ms).toBe(DEFAULT_RETRY_POLICY.initialBackoffMs);
  });

  test('grows geometrically', () => {
    const ms = nextBackoffMs(
      { ...DEFAULT_RETRY_POLICY, jitter: 0, initialBackoffMs: 1000, factor: 2 },
      3,
      () => 0.5,
    );
    expect(ms).toBe(4000);
  });

  test('caps at maxBackoffMs', () => {
    const ms = nextBackoffMs(
      { ...DEFAULT_RETRY_POLICY, jitter: 0, initialBackoffMs: 1000, factor: 2, maxBackoffMs: 3000 },
      10,
      () => 0.5,
    );
    expect(ms).toBe(3000);
  });

  test('applies jitter', () => {
    const mid = nextBackoffMs(
      { ...DEFAULT_RETRY_POLICY, jitter: 0.5, initialBackoffMs: 100, factor: 1 },
      1,
      () => 1,
    );
    const low = nextBackoffMs(
      { ...DEFAULT_RETRY_POLICY, jitter: 0.5, initialBackoffMs: 100, factor: 1 },
      1,
      () => 0,
    );
    expect(mid).toBeGreaterThan(low);
  });
});

describe('classifyResponse', () => {
  test('2xx → succeeded', () => {
    expect(classifyResponse(200, 1, DEFAULT_RETRY_POLICY, () => 0.5).action).toBe('succeeded');
    expect(classifyResponse(204, 1, DEFAULT_RETRY_POLICY, () => 0.5).action).toBe('succeeded');
  });

  test('500 → retry until max then dead-letter', () => {
    const first = classifyResponse(500, 1, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(first.action).toBe('retry');
    const last = classifyResponse(500, DEFAULT_RETRY_POLICY.maxAttempts, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(last.action).toBe('dead-letter');
  });

  test('429 retries then dead-letters', () => {
    const r = classifyResponse(429, 1, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(r.action).toBe('retry');
  });

  test('408 retries', () => {
    const r = classifyResponse(408, 1, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(r.action).toBe('retry');
  });

  test('400 → client-error permanent', () => {
    const r = classifyResponse(400, 1, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(r.action).toBe('client-error');
  });

  test('403 → client-error', () => {
    const r = classifyResponse(403, 1, DEFAULT_RETRY_POLICY, () => 0.5);
    expect(r.action).toBe('client-error');
  });
});
