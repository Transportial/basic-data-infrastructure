// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { Scheduler } from '../src/scheduler.ts';

function freezeClock(at = new Date('2026-04-23T10:00:00Z').getTime()) {
  return () => at;
}

describe('Scheduler', () => {
  test('register + trigger runs the job', async () => {
    const s = new Scheduler({ now: freezeClock() });
    let ran = 0;
    s.register({
      id: 'j1',
      description: 'test',
      intervalMs: 1000,
      async run() {
        ran += 1;
      },
    });
    const r = await s.trigger('j1');
    expect(r.success).toBe(true);
    expect(r.jobId).toBe('j1');
    expect(ran).toBe(1);
  });

  test('trigger unknown throws', async () => {
    const s = new Scheduler();
    await expect(s.trigger('nope')).rejects.toThrow();
  });

  test('duplicate register throws', () => {
    const s = new Scheduler();
    const job = { id: 'j', description: 'd', intervalMs: 1, async run() {} };
    s.register(job);
    expect(() => s.register(job)).toThrow();
  });

  test('triggerAll runs all jobs', async () => {
    const s = new Scheduler();
    let a = 0;
    let b = 0;
    s.register({ id: 'a', description: 'a', intervalMs: 1, async run() { a += 1; } });
    s.register({ id: 'b', description: 'b', intervalMs: 1, async run() { b += 1; } });
    const results = await s.triggerAll();
    expect(results).toHaveLength(2);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test('failed job is recorded', async () => {
    const s = new Scheduler();
    s.register({ id: 'f', description: 'f', intervalMs: 1, async run() { throw new Error('boom'); } });
    const r = await s.trigger('f');
    expect(r.success).toBe(false);
    expect(r.error).toContain('boom');
    expect(s.history).toHaveLength(1);
  });

  test('non-Error thrown value is serialised', async () => {
    const s = new Scheduler();
    s.register({ id: 'f', description: 'f', intervalMs: 1, async run() { throw 'string-error'; } });
    const r = await s.trigger('f');
    expect(r.error).toBe('string-error');
  });

  test('list returns registered job metadata', () => {
    const s = new Scheduler();
    s.register({ id: 'j', description: 'd', intervalMs: 1000, async run() {} });
    expect(s.list()).toEqual([{ id: 'j', description: 'd', intervalMs: 1000 }]);
  });

  test('start uses injected timer and reschedules on tick', async () => {
    const pending: Array<() => void> = [];
    let counter = 0;
    const setTimer = (cb: () => void) => {
      pending.push(cb);
      return (++counter) as unknown as ReturnType<typeof setTimeout>;
    };
    const clearTimer = () => {};
    const s = new Scheduler({ setTimer, clearTimer });
    let runs = 0;
    s.register({ id: 'j', description: 'd', intervalMs: 1, async run() { runs += 1; } });
    s.start();
    expect(pending.length).toBe(1);
    pending.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(1);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    s.stop();
  });

  test('register after start schedules immediately', () => {
    const pending: Array<() => void> = [];
    let counter = 0;
    const setTimer = (cb: () => void) => {
      pending.push(cb);
      return (++counter) as unknown as ReturnType<typeof setTimeout>;
    };
    const s = new Scheduler({ setTimer, clearTimer: () => {} });
    s.start();
    expect(pending.length).toBe(0);
    s.register({ id: 'j', description: 'd', intervalMs: 1, async run() {} });
    expect(pending.length).toBe(1);
    s.stop();
  });

  test('start is idempotent', () => {
    const s = new Scheduler({ setTimer: () => ({}) as unknown as ReturnType<typeof setTimeout>, clearTimer: () => {} });
    s.start();
    s.start();
    s.stop();
  });
});
