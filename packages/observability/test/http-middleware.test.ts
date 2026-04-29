// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { createLogger, createMemorySink } from '../src/logger.ts';
import { MetricsRegistry } from '../src/metrics.ts';
import {
  ObservabilityLayer,
  currentRequestContext,
  currentTrace,
} from '../src/http-middleware.ts';

function mkLayer() {
  const sink = createMemorySink();
  const logger = createLogger({ level: 'trace', sink: sink.sink });
  const metrics = new MetricsRegistry();
  const layer = new ObservabilityLayer({ logger, metrics, service: 'asr' });
  return { sink, logger, metrics, layer };
}

describe('ObservabilityLayer', () => {
  test('records a span + metric per observed call', async () => {
    const { layer, metrics } = mkLayer();
    await layer.observe('test', null, { route: '/x', method: 'GET' }, async () => ({
      status: 200,
    }));
    const spans = layer.recent();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe(200);
    const counter = metrics.counter('asr_http_requests_total', '');
    expect(counter.value({ service: 'asr', route: '/x', method: 'GET', status: '200' })).toBe(1);
  });

  test('honours inbound traceparent', async () => {
    const { layer } = mkLayer();
    await layer.observe(
      't',
      '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01',
      {},
      async () => ({ status: 200 }),
    );
    const s = layer.recent()[0]!;
    expect(s.trace.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  test('binds RequestContext into AsyncLocalStorage for child code', async () => {
    const { layer } = mkLayer();
    let seenTraceId: string | null = null;
    await layer.observe('t', null, { route: '/x' }, async () => {
      seenTraceId = currentRequestContext()?.trace.traceId ?? null;
      return { status: 204 };
    });
    expect(seenTraceId).not.toBeNull();
  });

  test('currentTrace falls back to a fresh context outside a span', () => {
    const t = currentTrace();
    expect(t.trace_id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('currentTrace inside a span reuses the running context', async () => {
    const { layer } = mkLayer();
    let inner: { trace_id: string; span_id: string } | null = null;
    await layer.observe('t', null, {}, async () => {
      inner = currentTrace();
      return { status: 200 };
    });
    expect(inner).not.toBeNull();
  });

  test('drain empties the buffer and returns the recorded spans', async () => {
    const { layer } = mkLayer();
    await layer.observe('a', null, {}, async () => ({ status: 200 }));
    await layer.observe('b', null, {}, async () => ({ status: 200 }));
    const drained = layer.drain();
    expect(drained).toHaveLength(2);
    expect(layer.recent()).toHaveLength(0);
  });

  test('still records a span when the handler throws', async () => {
    const { layer } = mkLayer();
    await expect(
      layer.observe('fail', null, { route: '/boom' }, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(layer.recent()[0]?.status).toBe(500);
  });

  test('trims the buffer when it exceeds the cap', async () => {
    const { layer } = mkLayer();
    for (let i = 0; i < 3000; i++) {
      await layer.observe('t', null, {}, async () => ({ status: 200 }));
    }
    expect(layer.recent().length).toBeLessThanOrEqual(2048);
  });
});
