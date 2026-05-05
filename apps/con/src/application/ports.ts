// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { ClockPort } from '@transportial/kernel';
import type {
  BvadClaims,
  BvodClaims,
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/contracts';
import type { PolicyDecisionPoint } from '@transportial/policy';
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

export type {
  ClockPort,
  PolicyDecisionPoint,
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
};
