// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Result } from '@bdi/kernel';
import { compactVerify, type TrustlistResolver } from '@bdi/crypto';
import type { ClockPort, EventBusPort } from '../ports.ts';

export type ReceiveWebhookError =
  | { type: 'missing-headers' }
  | { type: 'signature-invalid' }
  | { type: 'replay-detected'; event_id: string }
  | { type: 'issuer-not-allowed'; issuer: string }
  | { type: 'body-hash-mismatch' };

export interface ReceiveWebhookInput {
  readonly jws: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly issuer: string;
  readonly body: string;
}

export interface ReplayCache {
  seen(key: string): Promise<boolean>;
  remember(key: string, ttlSeconds: number): Promise<void>;
}

export interface ReceiveWebhookConfig {
  readonly allowedIssuers: ReadonlyArray<string>;
  readonly replayTtlSeconds?: number;
}

// Validates inbound webhooks (from the peer that published on the ORS event
// stream) before handing them off to the backend. Checks:
// 1. Required BDI headers present
// 2. JWS over the body verifies against the peer issuer's trustlist resolver
// 3. Event-id hasn't been seen recently (replay protection)
// 4. Issuer is in the configured allowlist
export class ReceiveWebhookUseCase {
  constructor(
    private readonly resolver: TrustlistResolver,
    private readonly replay: ReplayCache,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
    private readonly config: ReceiveWebhookConfig,
    private readonly associationId: string,
  ) {}

  async execute(input: ReceiveWebhookInput): Promise<Result<{ payload: unknown }, ReceiveWebhookError>> {
    if (!input.jws || !input.eventId || !input.eventType) {
      return err({ type: 'missing-headers' });
    }
    if (!this.config.allowedIssuers.includes(input.issuer)) {
      return err({ type: 'issuer-not-allowed', issuer: input.issuer });
    }
    if (await this.replay.seen(input.eventId)) {
      return err({ type: 'replay-detected', event_id: input.eventId });
    }

    const verified = await compactVerify(input.jws, this.resolver);
    if (!verified.ok) return err({ type: 'signature-invalid' });
    const payload = verified.value.payload as { body_sha256?: string };
    const actualHash = await sha256B64(new TextEncoder().encode(input.body));
    if (payload.body_sha256 && payload.body_sha256 !== actualHash) {
      return err({ type: 'body-hash-mismatch' });
    }

    await this.replay.remember(input.eventId, this.config.replayTtlSeconds ?? 7 * 86_400);
    await this.bus.publish('con.signature.verified', this.associationId, {
      event_id: input.eventId,
      event_type: input.eventType,
      issuer: input.issuer,
      at: this.clock.nowIso(),
    });
    let bodyJson: unknown;
    try {
      bodyJson = JSON.parse(input.body);
    } catch {
      bodyJson = input.body;
    }
    return ok({ payload: bodyJson });
  }
}

export class InMemoryReplayCache implements ReplayCache {
  private readonly store = new Map<string, number>();
  async seen(key: string): Promise<boolean> {
    this.prune();
    return this.store.has(key);
  }
  async remember(key: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, Math.floor(Date.now() / 1000) + ttlSeconds);
  }
  private prune(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, exp] of this.store) if (exp < now) this.store.delete(k);
  }
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let s = '';
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
