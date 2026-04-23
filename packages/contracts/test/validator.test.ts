// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
import { describe, test, expect } from 'bun:test';
import { err, ok } from '@bdi/kernel';
import { combineIssues, isObject, issue, fail } from '../src/validator.ts';

describe('validator helpers', () => {
  test('isObject filters nulls and arrays', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject('x')).toBe(false);
    expect(isObject(1)).toBe(false);
  });

  test('issue constructs an issue object', () => {
    expect(issue(['a'], 'bad')).toEqual({ path: ['a'], reason: 'bad' });
  });

  test('fail wraps a single issue as Err', () => {
    const r = fail(['x'], 'bad');
    expect(!r.ok && r.error[0]?.reason).toBe('bad');
  });

  test('combineIssues Ok + Ok', () => {
    const r = combineIssues(ok(1), ok('a'));
    expect(r.ok && r.value).toEqual([1, 'a']);
  });

  test('combineIssues Ok + Err', () => {
    const r = combineIssues(ok(1), err([{ path: [], reason: 'b' }]));
    expect(!r.ok && r.error[0]?.reason).toBe('b');
  });

  test('combineIssues Err + Ok', () => {
    const r = combineIssues(err([{ path: [], reason: 'a' }]), ok(1));
    expect(!r.ok && r.error[0]?.reason).toBe('a');
  });

  test('combineIssues Err + Err merges issues', () => {
    const r = combineIssues(
      err([{ path: [], reason: 'a' }]),
      err([{ path: [], reason: 'b' }]),
    );
    expect(!r.ok && r.error.length).toBe(2);
  });
});
