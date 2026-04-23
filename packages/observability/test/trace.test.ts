// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  generateTraceId,
  generateSpanId,
  newContext,
  parseTraceparent,
} from '../src/trace.ts';

describe('trace', () => {
  test('generateTraceId is 32 hex chars', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  test('generateSpanId is 16 hex chars', () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  test('newContext produces well-formed traceparent', () => {
    const c = newContext();
    expect(c.traceparent).toBe(`00-${c.traceId}-${c.spanId}-01`);
  });

  test('parseTraceparent accepts valid', () => {
    const raw = '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01';
    const ctx = parseTraceparent(raw);
    expect(ctx?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx?.spanId).toBe('b9c7c989f97918e1');
  });

  test('parseTraceparent rejects null/undefined/empty', () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
  });

  test('parseTraceparent rejects wrong part count', () => {
    expect(parseTraceparent('00-abc-def')).toBeNull();
  });

  test('parseTraceparent rejects wrong version', () => {
    expect(parseTraceparent('ff-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01')).toBeNull();
  });

  test('parseTraceparent rejects malformed trace id', () => {
    expect(parseTraceparent('00-short-b9c7c989f97918e1-01')).toBeNull();
  });

  test('parseTraceparent rejects malformed span id', () => {
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-short-01')).toBeNull();
  });

  test('parseTraceparent rejects all-zero trace id', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-b9c7c989f97918e1-01')).toBeNull();
  });

  test('parseTraceparent rejects all-zero span id', () => {
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01')).toBeNull();
  });
});
