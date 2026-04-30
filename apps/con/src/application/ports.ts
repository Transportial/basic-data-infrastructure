// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { ClockPort } from '@transportial/kernel';
import type { BvadClaims, BvodClaims } from '@transportial/contracts';
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

// PayloadInspector is the extension point for "recipes": optional, payload-aware
// add-ons (OTM, eFTI, FHIR, ...) that validate and tag domain data before the
// connector authorises the call. Each inspector decides whether it applies to a
// given request via `matches`; if it does, `inspect` either accepts the payload
// (optionally returning resource tags that get merged into the PDP resource) or
// rejects it with a structured reason.
export interface PayloadInspectionRequest {
  readonly method: string;
  readonly path: string;
  readonly contentType: string;
  readonly body: string;
}

export type PayloadInspectionResult =
  | { readonly ok: true; readonly resourceTags?: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: string; readonly details?: ReadonlyArray<string> };

export interface PayloadInspectorPort {
  readonly name: string;
  matches(req: PayloadInspectionRequest): boolean;
  inspect(req: PayloadInspectionRequest): Promise<PayloadInspectionResult>;
}

export type { ClockPort, PolicyDecisionPoint };
