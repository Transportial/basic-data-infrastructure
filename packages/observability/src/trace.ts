// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Lightweight W3C Trace Context helpers. For production we'd delegate to the
// OpenTelemetry SDK, but an in-process implementation keeps the kernel fast
// and dependency-free, and is perfectly sufficient for test fixtures.

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceparent: string;
}

export function generateTraceId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function generateSpanId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

export function newContext(): TraceContext {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

export function parseTraceparent(raw: string | undefined | null): TraceContext | null {
  if (!raw) return null;
  const parts = raw.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId] = parts;
  if (version !== '00') return null;
  if (!traceId || !/^[0-9a-f]{32}$/.test(traceId)) return null;
  if (!spanId || !/^[0-9a-f]{16}$/.test(spanId)) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, traceparent: raw };
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
