// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { ConnectorLookupPort } from '../application/ports.ts';

// In-memory cache of callback URLs per connector. Populated from ASR events
// (`asr.connector.registered`, `asr.trustlist.updated`). Keeping this
// adapter separate from the ASR-events consumer means the production
// substitute — Valkey-backed cache with Pub/Sub invalidation — slots in
// without touching the use case.
export class InMemoryConnectorLookup implements ConnectorLookupPort {
  private readonly callbacks = new Map<string, ReadonlyArray<string>>();

  register(connectorId: string, urls: ReadonlyArray<string>): void {
    this.callbacks.set(connectorId, urls);
  }

  async listCallbacks(connectorId: string): Promise<ReadonlyArray<string>> {
    return this.callbacks.get(connectorId) ?? [];
  }
}
