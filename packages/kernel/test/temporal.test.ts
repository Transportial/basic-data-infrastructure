// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { SystemClock, FakeClock } from '../src/temporal/clock.ts';
import { parseDuration, formatDurationSeconds } from '../src/temporal/duration.ts';
import {
  parseInstant,
  instantFromUnix,
  instantToUnix,
  addSeconds,
  isBefore,
  isAfter,
} from '../src/temporal/instant.ts';

describe('SystemClock', () => {
  test('returns ISO string', () => {
    const c = new SystemClock();
    expect(c.nowIso()).toMatch(/T.*Z$/);
  });

  test('returns unix seconds', () => {
    const c = new SystemClock();
    expect(c.nowUnix()).toBeGreaterThan(1_700_000_000);
  });

  test('returns millis', () => {
    const c = new SystemClock();
    expect(c.nowMillis()).toBeGreaterThan(1_700_000_000_000);
  });
});

describe('FakeClock', () => {
  test('initialises from default', () => {
    const c = new FakeClock();
    expect(c.nowIso()).toBe('2026-04-23T10:00:00.000Z');
  });

  test('initialises from string', () => {
    const c = new FakeClock('2026-01-01T00:00:00.000Z');
    expect(c.nowUnix()).toBe(1767225600);
  });

  test('initialises from number (ms)', () => {
    const c = new FakeClock(0);
    expect(c.nowIso()).toBe('1970-01-01T00:00:00.000Z');
  });

  test('initialises from Date', () => {
    const c = new FakeClock(new Date('2020-01-01T00:00:00.000Z'));
    expect(c.nowIso()).toBe('2020-01-01T00:00:00.000Z');
  });

  test('advance moves time forward', () => {
    const c = new FakeClock('2026-01-01T00:00:00.000Z');
    c.advance(3600_000);
    expect(c.nowIso()).toBe('2026-01-01T01:00:00.000Z');
  });

  test('set resets', () => {
    const c = new FakeClock();
    c.set('2030-01-01T00:00:00.000Z');
    expect(c.nowIso()).toBe('2030-01-01T00:00:00.000Z');
  });

  test('set accepts number', () => {
    const c = new FakeClock();
    c.set(0);
    expect(c.nowUnix()).toBe(0);
  });

  test('set accepts Date', () => {
    const c = new FakeClock();
    c.set(new Date('1990-06-01T00:00:00.000Z'));
    expect(c.nowIso()).toBe('1990-06-01T00:00:00.000Z');
  });

  test('nowMillis', () => {
    const c = new FakeClock(12345);
    expect(c.nowMillis()).toBe(12345);
  });
});

describe('Duration', () => {
  test('parses days only', () => {
    const r = parseDuration('P7D');
    expect(r.ok && r.value.seconds).toBe(7 * 86400);
  });

  test('parses hours/minutes/seconds', () => {
    const r = parseDuration('PT1H30M45S');
    expect(r.ok && r.value.seconds).toBe(3600 + 1800 + 45);
  });

  test('parses combined days + time', () => {
    const r = parseDuration('P1DT2H');
    expect(r.ok && r.value.seconds).toBe(86400 + 7200);
  });

  test('parses fractional seconds', () => {
    const r = parseDuration('PT0.5S');
    expect(r.ok && r.value.seconds).toBe(0.5);
  });

  test('rejects empty', () => {
    const r = parseDuration('');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects invalid', () => {
    const r = parseDuration('1 day');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects empty duration (P only)', () => {
    const r = parseDuration('P');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('formatDurationSeconds zero → PT0S', () => {
    expect(formatDurationSeconds(0)).toBe('PT0S');
  });

  test('formatDurationSeconds hms', () => {
    expect(formatDurationSeconds(3725)).toBe('PT1H2M5S');
  });

  test('formatDurationSeconds days+time', () => {
    expect(formatDurationSeconds(90061)).toBe('P1DT1H1M1S');
  });

  test('formatDurationSeconds days only', () => {
    expect(formatDurationSeconds(86400)).toBe('P1D');
  });

  test('formatDurationSeconds throws on negative', () => {
    expect(() => formatDurationSeconds(-1)).toThrow();
  });
});

describe('Instant', () => {
  test('parseInstant accepts ISO', () => {
    const r = parseInstant('2026-04-23T10:00:00Z');
    expect(r.ok).toBe(true);
  });

  test('parseInstant rejects garbage', () => {
    const r = parseInstant('not-a-date');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('instantFromUnix', () => {
    expect(instantFromUnix(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  test('instantToUnix', () => {
    const i = instantFromUnix(1_000_000_000);
    expect(instantToUnix(i)).toBe(1_000_000_000);
  });

  test('addSeconds', () => {
    const i = instantFromUnix(0);
    expect(addSeconds(i, 60)).toBe('1970-01-01T00:01:00.000Z');
  });

  test('isBefore', () => {
    expect(isBefore(instantFromUnix(0), instantFromUnix(1))).toBe(true);
    expect(isBefore(instantFromUnix(1), instantFromUnix(0))).toBe(false);
  });

  test('isAfter', () => {
    expect(isAfter(instantFromUnix(1), instantFromUnix(0))).toBe(true);
    expect(isAfter(instantFromUnix(0), instantFromUnix(1))).toBe(false);
  });
});
