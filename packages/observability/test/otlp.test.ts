// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { MetricsRegistry } from '../src/metrics.ts';
import { newContext } from '../src/trace.ts';
import { OtlpExporter, RecordingOtlpTransport } from '../src/otlp.ts';

describe('OtlpExporter', () => {
  const resource = {
    'service.name': 'asr',
    'service.version': '0.1.0',
    'deployment.environment': 'test',
  } as const;

  test('exportSpans sends POST with correct URL and body', async () => {
    const t = new RecordingOtlpTransport();
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    const ctx = newContext();
    const ok = await e.exportSpans([
      {
        name: 'POST /admin/members',
        kind: 'SERVER',
        context: ctx,
        startUnixNano: 1n,
        endUnixNano: 2n,
        attributes: { 'http.status': 200, 'bdi.association_id': 'ctn' },
        status: { code: 'OK' },
        events: [{ name: 'e1', timeUnixNano: 1n, attributes: { key: 'v' } }],
      },
    ]);
    expect(ok).toBe(true);
    expect(t.calls[0]?.url).toBe('http://otel:4318/v1/traces');
    const body = JSON.parse(t.calls[0]!.body) as { resourceSpans: unknown[] };
    expect(body.resourceSpans.length).toBe(1);
  });

  test('exportSpans empty array is a no-op success', async () => {
    const t = new RecordingOtlpTransport();
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    const ok = await e.exportSpans([]);
    expect(ok).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  test('exportSpans supports all kinds and error statuses', async () => {
    const t = new RecordingOtlpTransport();
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    const ctx = newContext();
    await e.exportSpans([
      { name: 'a', kind: 'INTERNAL', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: {}, status: { code: 'ERROR', message: 'x' } },
      { name: 'b', kind: 'CLIENT', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: { bool: true } },
      { name: 'c', kind: 'PRODUCER', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: { n: 1.5 }, parentSpanId: '1111111111111111' },
      { name: 'd', kind: 'CONSUMER', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: {}, status: { code: 'UNSET' } },
    ]);
    expect(t.calls).toHaveLength(1);
  });

  test('exportSpans returns false on transport failure', async () => {
    const t = new RecordingOtlpTransport(() => 500);
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    const ctx = newContext();
    const ok = await e.exportSpans([
      { name: 'x', kind: 'SERVER', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: {} },
    ]);
    expect(ok).toBe(false);
  });

  test('exportSpans returns false on transport throw', async () => {
    const throwingTransport = {
      async post(): Promise<{ status: number }> {
        throw new Error('net');
      },
    };
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: throwingTransport });
    const ctx = newContext();
    const ok = await e.exportSpans([
      { name: 'x', kind: 'SERVER', context: ctx, startUnixNano: 0n, endUnixNano: 1n, attributes: {} },
    ]);
    expect(ok).toBe(false);
  });

  test('exportMetrics sends counters and histograms', async () => {
    const t = new RecordingOtlpTransport();
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    const registry = new MetricsRegistry();
    const c = registry.counter('bdi_requests_total', 'req');
    c.inc({ route: '/a' });
    const h = registry.histogram('bdi_latency', 'latency', [0.1, 1]);
    h.observe(0.5);
    const ok = await e.exportMetrics(registry);
    expect(ok).toBe(true);
    expect(t.calls[0]?.url).toBe('http://otel:4318/v1/metrics');
  });

  test('exportMetrics with empty registry still posts', async () => {
    const t = new RecordingOtlpTransport();
    const e = new OtlpExporter({ endpoint: 'http://otel:4318', resource, transport: t });
    await e.exportMetrics(new MetricsRegistry());
    expect(t.calls).toHaveLength(1);
  });
});
