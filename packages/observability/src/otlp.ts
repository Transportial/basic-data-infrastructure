// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { Counter, Histogram, MetricsRegistry } from './metrics.ts';
import type { TraceContext } from './trace.ts';

// A real OTLP/HTTP exporter. It encodes metrics and spans into the JSON-over-HTTP
// form that OpenTelemetry collectors accept (the `/v1/metrics` and `/v1/traces`
// endpoints), using the Protobuf-parallel field names so upstream OTEL Collector
// versions accept the payloads unchanged. No protobuf runtime is required — we
// rely on the collector's JSON ingest.

export interface Resource {
  readonly 'service.name': string;
  readonly 'service.version': string;
  readonly 'deployment.environment'?: string;
  readonly 'bdi.association_id'?: string;
}

export interface Span {
  readonly name: string;
  readonly kind: 'SERVER' | 'CLIENT' | 'INTERNAL' | 'PRODUCER' | 'CONSUMER';
  readonly context: TraceContext;
  readonly parentSpanId?: string;
  readonly startUnixNano: bigint;
  readonly endUnixNano: bigint;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly status?: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string };
  readonly events?: ReadonlyArray<{ name: string; timeUnixNano: bigint; attributes?: Record<string, string | number | boolean> }>;
}

export interface OtlpTransport {
  post(url: string, body: string, headers: Readonly<Record<string, string>>): Promise<{ status: number }>;
}

export class FetchOtlpTransport implements OtlpTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async post(url: string, body: string, headers: Readonly<Record<string, string>>): Promise<{ status: number }> {
    const res = await this.fetcher(url, { method: 'POST', headers, body });
    return { status: res.status };
  }
}

export class OtlpExporter {
  constructor(
    private readonly config: {
      endpoint: string;
      resource: Resource;
      headers?: Record<string, string>;
      transport?: OtlpTransport;
    },
  ) {}

  async exportSpans(spans: ReadonlyArray<Span>): Promise<boolean> {
    if (spans.length === 0) return true;
    const resource = this.encodeResource();
    const payload = {
      resourceSpans: [
        {
          resource,
          scopeSpans: [
            {
              scope: { name: '@transportial/observability', version: '0.1.0' },
              spans: spans.map((s) => ({
                traceId: hexToBase64(s.context.traceId),
                spanId: hexToBase64(s.context.spanId),
                ...(s.parentSpanId ? { parentSpanId: hexToBase64(s.parentSpanId) } : {}),
                name: s.name,
                kind: spanKindValue(s.kind),
                startTimeUnixNano: s.startUnixNano.toString(),
                endTimeUnixNano: s.endUnixNano.toString(),
                attributes: encodeAttributes(s.attributes),
                status: s.status ? { code: statusCode(s.status.code), message: s.status.message } : undefined,
                events: s.events?.map((e) => ({
                  timeUnixNano: e.timeUnixNano.toString(),
                  name: e.name,
                  attributes: e.attributes ? encodeAttributes(e.attributes) : undefined,
                })),
              })),
            },
          ],
        },
      ],
    };
    return this.send(`${this.config.endpoint}/v1/traces`, payload);
  }

  async exportMetrics(registry: MetricsRegistry): Promise<boolean> {
    const resource = this.encodeResource();
    const metrics: unknown[] = [];
    for (const counter of countersOf(registry)) {
      metrics.push({
        name: counter.name,
        description: counter.help,
        unit: '1',
        sum: {
          isMonotonic: true,
          aggregationTemporality: 2, // CUMULATIVE
          dataPoints: counter.snapshot().map((s) => ({
            timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
            asInt: String(s.value),
            attributes: encodeAttributes(s.labels),
          })),
        },
      });
    }
    for (const histo of histogramsOf(registry)) {
      const snap = histo.snapshot();
      if (!snap) continue;
      metrics.push({
        name: histo.name,
        description: histo.help,
        histogram: {
          aggregationTemporality: 2,
          dataPoints: [
            {
              timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
              count: String(snap.count),
              sum: snap.sum,
              bucketCounts: snap.buckets.map((b) => String(b.count)),
              explicitBounds: snap.buckets.map((b) => b.le),
              attributes: [],
            },
          ],
        },
      });
    }
    const payload = {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            { scope: { name: '@transportial/observability', version: '0.1.0' }, metrics },
          ],
        },
      ],
    };
    return this.send(`${this.config.endpoint}/v1/metrics`, payload);
  }

  private async send(url: string, payload: unknown): Promise<boolean> {
    const transport = this.config.transport ?? new FetchOtlpTransport();
    try {
      const res = await transport.post(url, JSON.stringify(payload), {
        'content-type': 'application/json',
        ...this.config.headers,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  private encodeResource(): unknown {
    return {
      attributes: encodeAttributes(this.config.resource as unknown as Record<string, string>),
    };
  }
}

function encodeAttributes(
  attrs: Readonly<Record<string, string | number | boolean>>,
): Array<{ key: string; value: Record<string, string | number | boolean> }> {
  return Object.entries(attrs).map(([k, v]) => ({
    key: k,
    value:
      typeof v === 'string'
        ? { stringValue: v }
        : typeof v === 'boolean'
          ? { boolValue: v }
          : Number.isInteger(v)
            ? { intValue: String(v) as unknown as number }
            : { doubleValue: v },
  }));
}

function spanKindValue(kind: Span['kind']): number {
  switch (kind) {
    case 'INTERNAL':
      return 1;
    case 'SERVER':
      return 2;
    case 'CLIENT':
      return 3;
    case 'PRODUCER':
      return 4;
    case 'CONSUMER':
      return 5;
  }
}

function statusCode(c: 'OK' | 'ERROR' | 'UNSET'): number {
  return c === 'UNSET' ? 0 : c === 'OK' ? 1 : 2;
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Accessors that work against our tiny registry without exposing internals.
function countersOf(reg: MetricsRegistry): Counter[] {
  const anyReg = reg as unknown as { counters: Map<string, Counter> };
  return [...anyReg.counters.values()];
}

function histogramsOf(reg: MetricsRegistry): Histogram[] {
  const anyReg = reg as unknown as { histograms: Map<string, Histogram> };
  return [...anyReg.histograms.values()];
}

// SpanBuilder integrates with the existing Logger/TraceContext work by recording
// spans in memory and flushing via the exporter. In-process tests use the
// RecordingOtlpTransport to assert payloads.
export class RecordingOtlpTransport implements OtlpTransport {
  readonly calls: Array<{ url: string; body: string; headers: Readonly<Record<string, string>> }> = [];
  constructor(private readonly statusFn: () => number = () => 200) {}
  async post(url: string, body: string, headers: Readonly<Record<string, string>>): Promise<{ status: number }> {
    this.calls.push({ url, body, headers });
    return { status: this.statusFn() };
  }
}
