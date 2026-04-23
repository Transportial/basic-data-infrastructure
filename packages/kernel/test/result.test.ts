// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  andThen,
  unwrap,
  unwrapOr,
} from '../src/result.ts';

describe('Result', () => {
  test('ok wraps value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  test('err wraps error', () => {
    const r = err('bad');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad');
  });

  test('isOk narrows', () => {
    const r = ok(1);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  test('isErr narrows', () => {
    const r = err(1);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  test('map transforms Ok', () => {
    const r = map(ok(2), (n) => n * 3);
    expect(r.ok && r.value).toBe(6);
  });

  test('map preserves Err', () => {
    const r = map(err<string>('x'), (n: number) => n * 2);
    expect(!r.ok && r.error).toBe('x');
  });

  test('mapErr transforms Err', () => {
    const r = mapErr(err('a'), (e) => `${e}!`);
    expect(!r.ok && r.error).toBe('a!');
  });

  test('mapErr preserves Ok', () => {
    const r = mapErr(ok(5), (e: string) => e.toUpperCase());
    expect(r.ok && r.value).toBe(5);
  });

  test('andThen chains', () => {
    const r = andThen(ok(4), (n) => ok(n + 1));
    expect(r.ok && r.value).toBe(5);
  });

  test('andThen short-circuits on Err', () => {
    const r = andThen(err<string>('no'), (n: number) => ok(n + 1));
    expect(!r.ok && r.error).toBe('no');
  });

  test('andThen propagates inner Err', () => {
    const r = andThen(ok(4), () => err('fail'));
    expect(!r.ok && r.error).toBe('fail');
  });

  test('unwrap returns Ok value', () => {
    expect(unwrap(ok(7))).toBe(7);
  });

  test('unwrap throws on Err', () => {
    expect(() => unwrap(err('x'))).toThrow();
  });

  test('unwrapOr returns Ok value', () => {
    expect(unwrapOr(ok(3), 99)).toBe(3);
  });

  test('unwrapOr returns fallback on Err', () => {
    expect(unwrapOr(err<string>('x'), 99)).toBe(99);
  });
});
