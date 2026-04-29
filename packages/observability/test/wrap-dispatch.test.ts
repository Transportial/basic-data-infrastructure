// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { createLogger } from '../src/logger.ts';
import { MetricsRegistry } from '../src/metrics.ts';
import { ObservabilityLayer } from '../src/http-middleware.ts';
import { wrapDispatch } from '../src/wrap-dispatch.ts';

describe('wrapDispatch', () => {
  test('wraps dispatch and records a span per call', async () => {
    const layer = new ObservabilityLayer({
      logger: createLogger({ sink: () => {} }),
      metrics: new MetricsRegistry(),
      service: 'asr',
    });
    const inner = async (req: { method: string; path: string }) => ({ status: 200, body: { path: req.path } });
    const wrapped = wrapDispatch(layer, inner);
    const out = await wrapped({ method: 'GET', path: '/x' });
    expect(out.status).toBe(200);
    expect(layer.recent()).toHaveLength(1);
  });

  test('propagates inbound traceparent', async () => {
    const layer = new ObservabilityLayer({
      logger: createLogger({ sink: () => {} }),
      metrics: new MetricsRegistry(),
      service: 'ors',
    });
    const wrapped = wrapDispatch(layer, async () => ({ status: 204 }));
    await wrapped({
      method: 'GET',
      path: '/y',
      headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01' },
    });
    expect(layer.recent()[0]?.trace.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  test('still records a span when handler throws', async () => {
    const layer = new ObservabilityLayer({
      logger: createLogger({ sink: () => {} }),
      metrics: new MetricsRegistry(),
      service: 'con',
    });
    const wrapped = wrapDispatch(layer, async () => {
      throw new Error('boom');
    });
    await expect(wrapped({ method: 'POST', path: '/z' })).rejects.toThrow('boom');
    expect(layer.recent()[0]?.status).toBe(500);
  });
});
