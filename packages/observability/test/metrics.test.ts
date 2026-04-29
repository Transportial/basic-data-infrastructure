// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { Counter, Histogram, MetricsRegistry } from '../src/metrics.ts';

describe('Counter', () => {
  test('default increment of 1', () => {
    const c = new Counter('requests_total', 'test');
    c.inc();
    expect(c.value()).toBe(1);
  });

  test('custom increment', () => {
    const c = new Counter('c', 'h');
    c.inc({}, 5);
    expect(c.value()).toBe(5);
  });

  test('labels are independent', () => {
    const c = new Counter('c', 'h');
    c.inc({ route: '/a' });
    c.inc({ route: '/b' });
    c.inc({ route: '/a' });
    expect(c.value({ route: '/a' })).toBe(2);
    expect(c.value({ route: '/b' })).toBe(1);
  });

  test('throws on negative delta', () => {
    const c = new Counter('c', 'h');
    expect(() => c.inc({}, -1)).toThrow();
  });

  test('value unset labels returns 0', () => {
    const c = new Counter('c', 'h');
    expect(c.value({ x: 'y' })).toBe(0);
  });

  test('reset clears state', () => {
    const c = new Counter('c', 'h');
    c.inc({ a: '1' });
    c.reset();
    expect(c.value({ a: '1' })).toBe(0);
  });

  test('snapshot returns all tracked label sets', () => {
    const c = new Counter('c', 'h');
    c.inc({ k: '1' });
    c.inc({ k: '2' });
    expect(c.snapshot()).toHaveLength(2);
  });
});

describe('Histogram', () => {
  test('observe records sum/count', () => {
    const h = new Histogram('lat', 'h');
    h.observe(0.2);
    h.observe(0.5);
    const s = h.snapshot();
    expect(s?.count).toBe(2);
    expect(s?.sum).toBeCloseTo(0.7);
  });

  test('buckets count values at or below le', () => {
    const h = new Histogram('lat', 'h', [0.1, 1, 10]);
    h.observe(0.05);
    h.observe(0.5);
    h.observe(5);
    const s = h.snapshot()!;
    expect(s.buckets[0]?.count).toBe(1);
    expect(s.buckets[1]?.count).toBe(2);
    expect(s.buckets[2]?.count).toBe(3);
  });

  test('default buckets used when none provided', () => {
    const h = new Histogram('lat', 'h');
    h.observe(1);
    expect(h.snapshot()?.buckets.length).toBeGreaterThan(5);
  });

  test('snapshot returns null for unseen labels', () => {
    const h = new Histogram('lat', 'h');
    expect(h.snapshot({ x: 'y' })).toBeNull();
  });

  test('reset clears data', () => {
    const h = new Histogram('lat', 'h');
    h.observe(1);
    h.reset();
    expect(h.snapshot()).toBeNull();
  });
});

describe('MetricsRegistry', () => {
  test('returns same counter on repeated lookup', () => {
    const r = new MetricsRegistry();
    const a = r.counter('c', 'h');
    const b = r.counter('c', 'h');
    expect(a).toBe(b);
  });

  test('returns same histogram on repeated lookup', () => {
    const r = new MetricsRegistry();
    const a = r.histogram('h', 'help');
    const b = r.histogram('h', 'help');
    expect(a).toBe(b);
  });

  test('render produces Prometheus text', () => {
    const r = new MetricsRegistry();
    const c = r.counter('bdi_requests_total', 'test');
    c.inc({ route: '/a', status: '200' });
    r.histogram('bdi_latency', 'test');
    const out = r.render();
    expect(out).toContain('# HELP bdi_requests_total');
    expect(out).toContain('# TYPE bdi_requests_total counter');
    expect(out).toContain('bdi_requests_total{route="/a",status="200"} 1');
    expect(out).toContain('# TYPE bdi_latency histogram');
  });

  test('renders empty labels', () => {
    const r = new MetricsRegistry();
    const c = r.counter('c', 'help');
    c.inc();
    expect(r.render()).toContain('c 1');
  });

  test('escapes quotes and backslashes in label values', () => {
    const r = new MetricsRegistry();
    const c = r.counter('c', 'h');
    c.inc({ v: 'a"b\\c\n' });
    const out = r.render();
    expect(out).toContain('a\\"b\\\\c\\n');
  });
});
