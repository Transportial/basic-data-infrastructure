// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { ok, type Result } from '@bdi/kernel';
import {
  classifyResponse,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  type WebhookDelivery,
} from '../../domain/webhook.ts';
import type {
  ClockPort,
  DeliveryRepository,
  EventBusPort,
  HttpClientPort,
} from '../ports.ts';

export interface DeliverWebhookConfig {
  readonly policy?: RetryPolicy;
  readonly associationId: string;
  readonly rand?: () => number;
}

export interface DeliverWebhookInput {
  readonly delivery: WebhookDelivery;
}

export type DeliverWebhookOutput =
  | { state: 'delivered' }
  | { state: 'retry'; delay_ms: number; attempt: number }
  | { state: 'dead'; reason: string }
  | { state: 'client-error'; reason: string };

export class DeliverWebhookUseCase {
  constructor(
    private readonly http: HttpClientPort,
    private readonly deliveries: DeliveryRepository,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
    private readonly config: DeliverWebhookConfig,
  ) {}

  async execute(input: DeliverWebhookInput): Promise<Result<DeliverWebhookOutput, never>> {
    const policy = this.config.policy ?? DEFAULT_RETRY_POLICY;
    const rand = this.config.rand ?? Math.random;
    const attempts = input.delivery.attempts + 1;

    let status = 0;
    let errorMessage: string | null = null;
    try {
      const resp = await this.http.post(
        input.delivery.target_url,
        input.delivery.body,
        {
          'content-type': 'application/json',
          'bdi-delivery-id': input.delivery.id,
          'bdi-event-id': input.delivery.event_id,
          'bdi-event-type': input.delivery.event_type,
        },
      );
      status = resp.status;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'unknown network error';
      status = 599;
    }

    const decision = classifyResponse(status, attempts, policy, rand);
    const now = this.clock.nowIso();

    if (decision.action === 'succeeded') {
      const updated: WebhookDelivery = {
        ...input.delivery,
        attempts,
        status: 'delivered',
        last_http_status: status,
        last_error: null,
        completed_at: now,
      };
      await this.deliveries.save(updated);
      await this.bus.publish('con.webhook.delivered', this.config.associationId, {
        delivery_id: updated.id,
        attempts,
      });
      return ok({ state: 'delivered' });
    }

    if (decision.action === 'retry') {
      const updated: WebhookDelivery = {
        ...input.delivery,
        attempts,
        status: 'pending',
        last_http_status: status,
        last_error: errorMessage,
        completed_at: null,
      };
      await this.deliveries.save(updated);
      await this.bus.publish('con.webhook.failed', this.config.associationId, {
        delivery_id: updated.id,
        attempts,
        http_status: status,
      });
      return ok({ state: 'retry', delay_ms: decision.delay_ms, attempt: attempts });
    }

    // dead-letter or permanent client error
    const updated: WebhookDelivery = {
      ...input.delivery,
      attempts,
      status: 'dead',
      last_http_status: status,
      last_error: decision.reason,
      completed_at: now,
    };
    await this.deliveries.save(updated);
    await this.bus.publish('con.webhook.dead-lettered', this.config.associationId, {
      delivery_id: updated.id,
      reason: decision.reason,
    });
    if (decision.action === 'client-error') {
      return ok({ state: 'client-error', reason: decision.reason });
    }
    return ok({ state: 'dead', reason: decision.reason });
  }
}
