// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { EventEnvelope } from '@bdi/contracts';

export type ConsumerHandler<T = unknown> = (envelope: EventEnvelope<T>) => Promise<void>;

export interface ConsumerDecision {
  readonly action: 'ack' | 'retry' | 'dead-letter';
  readonly reason?: string;
}

export interface ConsumerPolicy {
  readonly maxDeliveries: number;
}

export function classifyDelivery(
  deliveries: number,
  error: unknown,
  policy: ConsumerPolicy,
): ConsumerDecision {
  if (deliveries >= policy.maxDeliveries) {
    return { action: 'dead-letter', reason: serialiseError(error) };
  }
  return { action: 'retry', reason: serialiseError(error) };
}

export function serialiseError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'unserialisable error';
  }
}

export interface DeliveryRecord<T = unknown> {
  readonly envelope: EventEnvelope<T>;
  deliveries: number;
  lastError?: string;
}

export class InMemoryConsumer<T = unknown> {
  private readonly pending: DeliveryRecord<T>[] = [];
  private readonly dead: DeliveryRecord<T>[] = [];

  constructor(
    private readonly handler: ConsumerHandler<T>,
    private readonly policy: ConsumerPolicy = { maxDeliveries: 5 },
  ) {}

  submit(envelope: EventEnvelope<T>): void {
    this.pending.push({ envelope, deliveries: 0 });
  }

  deadLetterCount(): number {
    return this.dead.length;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  snapshotDead(): ReadonlyArray<DeliveryRecord<T>> {
    return this.dead;
  }

  async tick(): Promise<ConsumerDecision | null> {
    const record = this.pending.shift();
    if (!record) return null;
    record.deliveries += 1;
    try {
      await this.handler(record.envelope);
      return { action: 'ack' };
    } catch (e) {
      const decision = classifyDelivery(record.deliveries, e, this.policy);
      record.lastError = decision.reason ?? 'unknown';
      if (decision.action === 'retry') {
        this.pending.push(record);
      } else {
        this.dead.push(record);
      }
      return decision;
    }
  }
}
