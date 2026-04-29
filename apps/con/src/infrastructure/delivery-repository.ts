// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { DeliveryRepository } from '../application/ports.ts';
import type { WebhookDelivery } from '../domain/webhook.ts';

export class InMemoryDeliveryRepository implements DeliveryRepository {
  private readonly byId = new Map<string, WebhookDelivery>();

  async save(delivery: WebhookDelivery): Promise<void> {
    this.byId.set(delivery.id, delivery);
  }

  async find(id: string): Promise<WebhookDelivery | null> {
    return this.byId.get(id) ?? null;
  }

  async listPending(): Promise<ReadonlyArray<WebhookDelivery>> {
    return [...this.byId.values()].filter((d) => d.status === 'pending');
  }

  async listDead(): Promise<ReadonlyArray<WebhookDelivery>> {
    return [...this.byId.values()].filter((d) => d.status === 'dead');
  }
}
