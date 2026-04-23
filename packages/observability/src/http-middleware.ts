// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Counter, Histogram, MetricsRegistry } from './metrics.ts';
import type { Logger } from './logger.ts';
import { newContext, parseTraceparent, type TraceContext } from './trace.ts';

// Context carried alongside a request: trace ids, inbound BVAD claims, a
// logger enriched with request-scoped fields, and a timer start.
export interface RequestContext {
  readonly trace: TraceContext;
  readonly startMs: number;
  readonly attributes: Record<string, string>;
  readonly logger: Logger;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentTrace(): { trace_id: string; span_id: string } {
  const ctx = storage.getStore();
  if (!ctx) return newContextSafe();
  return { trace_id: ctx.trace.traceId, span_id: ctx.trace.spanId };
}

function newContextSafe(): { trace_id: string; span_id: string } {
  const c = newContext();
  return { trace_id: c.traceId, span_id: c.spanId };
}

export interface ObservabilityConfig {
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly service: string;
}

export interface SpanRecord {
  readonly name: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly trace: TraceContext;
  readonly attributes: Readonly<Record<string, string>>;
  readonly status: number;
}

export class ObservabilityLayer {
  private readonly httpRequests: Counter;
  private readonly httpDuration: Histogram;
  private readonly recentSpans: SpanRecord[] = [];

  constructor(private readonly config: ObservabilityConfig) {
    this.httpRequests = config.metrics.counter(
      `${config.service}_http_requests_total`,
      'Total HTTP requests handled',
    );
    this.httpDuration = config.metrics.histogram(
      `${config.service}_http_request_duration_seconds`,
      'HTTP request duration in seconds',
    );
  }

  // Wraps an async handler with a full observation span: allocates a trace
  // context (honouring an inbound traceparent), binds it into
  // AsyncLocalStorage so logs emitted during the request carry trace_id, and
  // records metrics + an in-memory span on completion.
  async observe(
    name: string,
    inboundTraceparent: string | null,
    attributes: Readonly<Record<string, string>>,
    handler: () => Promise<{ status: number }>,
  ): Promise<{ status: number }> {
    const existing = parseTraceparent(inboundTraceparent);
    const trace = existing ?? newContext();
    const startMs = Date.now();
    const attrs: Record<string, string> = { ...attributes };
    const childLogger = this.config.logger.child({
      trace_id: trace.traceId,
      span_id: trace.spanId,
    });
    const ctx: RequestContext = {
      trace,
      startMs,
      attributes: attrs,
      logger: childLogger,
    };
    return storage.run(ctx, async () => {
      let status = 500;
      try {
        const response = await handler();
        status = response.status;
        return response;
      } finally {
        const durationMs = Date.now() - startMs;
        this.httpRequests.inc({
          service: this.config.service,
          route: attrs.route ?? 'unknown',
          method: attrs.method ?? 'UNKNOWN',
          status: String(status),
        });
        this.httpDuration.observe(durationMs / 1000, {
          service: this.config.service,
          route: attrs.route ?? 'unknown',
          method: attrs.method ?? 'UNKNOWN',
        });
        this.recentSpans.push({
          name,
          startMs,
          durationMs,
          trace,
          attributes: { ...attrs, status: String(status) },
          status,
        });
        if (this.recentSpans.length > 2048) this.recentSpans.splice(0, this.recentSpans.length - 1024);
      }
    });
  }

  recent(): ReadonlyArray<SpanRecord> {
    return this.recentSpans;
  }

  drain(): ReadonlyArray<SpanRecord> {
    const out = this.recentSpans.slice();
    this.recentSpans.length = 0;
    return out;
  }
}
