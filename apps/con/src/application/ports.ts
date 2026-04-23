// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { ClockPort } from '@bdi/kernel';
import type { BvadClaims, BvodClaims } from '@bdi/contracts';
import type { PolicyDecisionPoint } from '@bdi/policy';
import type { WebhookDelivery } from '../domain/webhook.ts';

export interface TrustlistPort {
  refresh(): Promise<void>;
  verifyBvad(compact: string): Promise<BvadClaims | null>;
}

export interface OrsTrustPort {
  verifyBvod(compact: string): Promise<BvodClaims | null>;
}

export interface DeliveryRepository {
  save(delivery: WebhookDelivery): Promise<void>;
  find(id: string): Promise<WebhookDelivery | null>;
  listPending(): Promise<ReadonlyArray<WebhookDelivery>>;
  listDead(): Promise<ReadonlyArray<WebhookDelivery>>;
}

export interface HttpClientPort {
  post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number }>;
}

export interface EventBusPort {
  publish(type: string, associationId: string, body: unknown): Promise<void>;
}

export type { ClockPort, PolicyDecisionPoint };
