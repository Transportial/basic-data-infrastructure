// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  approve,
  isComplete,
  reject,
  type FourEyesApproval,
} from '../../src/domain/model/four-eyes.ts';

const base: FourEyesApproval = {
  id: 'a-1',
  subject_type: 'member_activation',
  subject_id: 'm-1',
  state: 'pending',
  first_approval: null,
  second_approval: null,
  created_at: 'now',
};

describe('approve', () => {
  test('pending + first approval → first', () => {
    const r = approve(base, 'alice', 't1');
    expect(r.ok && r.value.state).toBe('first');
    if (r.ok) expect(r.value.first_approval?.by).toBe('alice');
  });

  test('first + second different approver → completed', () => {
    const a = approve(base, 'alice', 't1');
    if (!a.ok) throw new Error('setup');
    const b = approve(a.value, 'bob', 't2');
    expect(b.ok && b.value.state).toBe('completed');
  });

  test('self-approval forbidden', () => {
    const a = approve(base, 'alice', 't1');
    if (!a.ok) throw new Error('setup');
    const r = approve(a.value, 'alice', 't2');
    expect(!r.ok && r.error.type).toBe('self-approval-forbidden');
  });

  test('completed cannot be approved again', () => {
    const a = approve(base, 'alice', 't1');
    if (!a.ok) throw new Error('setup');
    const b = approve(a.value, 'bob', 't2');
    if (!b.ok) throw new Error('setup');
    const r = approve(b.value, 'carol', 't3');
    expect(!r.ok && r.error.type).toBe('already-complete');
  });

  test('rejected cannot be approved', () => {
    const r = reject(base);
    if (!r.ok) throw new Error('setup');
    const a = approve(r.value, 'alice', 't1');
    expect(!a.ok && a.error.type).toBe('rejected');
  });
});

describe('reject', () => {
  test('pending → rejected', () => {
    const r = reject(base);
    expect(r.ok && r.value.state).toBe('rejected');
  });

  test('completed cannot be rejected', () => {
    const a = approve(base, 'alice', 't');
    if (!a.ok) throw new Error('setup');
    const b = approve(a.value, 'bob', 't');
    if (!b.ok) throw new Error('setup');
    const r = reject(b.value);
    expect(!r.ok && r.error.type).toBe('already-complete');
  });
});

describe('isComplete', () => {
  test('completed returns true', () => {
    expect(isComplete({ ...base, state: 'completed' })).toBe(true);
  });
  test('otherwise false', () => {
    expect(isComplete(base)).toBe(false);
  });
});
