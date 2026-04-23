// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

export type WebhookStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export interface WebhookDelivery {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly target_url: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly attempts: number;
  readonly status: WebhookStatus;
  readonly last_http_status: number | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly body: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly factor: number;
  readonly jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  initialBackoffMs: 5_000,
  maxBackoffMs: 3_600_000,
  factor: 2,
  jitter: 0.1,
};

export function nextBackoffMs(policy: RetryPolicy, attempt: number, randSource: () => number): number {
  const base = Math.min(
    policy.maxBackoffMs,
    policy.initialBackoffMs * Math.pow(policy.factor, Math.max(0, attempt - 1)),
  );
  const jitterPortion = base * policy.jitter;
  return Math.floor(base + (randSource() - 0.5) * 2 * jitterPortion);
}

export type DeliveryDecision =
  | { action: 'succeeded' }
  | { action: 'retry'; delay_ms: number }
  | { action: 'dead-letter'; reason: string }
  | { action: 'client-error'; reason: string };

export function classifyResponse(
  status: number,
  attempt: number,
  policy: RetryPolicy,
  randSource: () => number,
): DeliveryDecision {
  if (status >= 200 && status < 300) return { action: 'succeeded' };
  if (status === 408 || status === 429 || status >= 500) {
    if (attempt >= policy.maxAttempts) {
      return { action: 'dead-letter', reason: `http-${status}-after-${attempt}-attempts` };
    }
    return { action: 'retry', delay_ms: nextBackoffMs(policy, attempt + 1, randSource) };
  }
  // 4xx other than 408/429 → permanent
  return { action: 'client-error', reason: `http-${status}` };
}
