// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Jwk, type Result } from '@bdi/kernel';
import { verifyClientAssertion, type AssertionError } from '@bdi/crypto';
import type { ClockPort, ConnectorRepository } from '../ports.ts';

export type AuthenticateClientError =
  | { type: 'unknown-client' }
  | { type: 'connector-not-active' }
  | { type: 'assertion-invalid'; reason: AssertionError['type'] }
  | { type: 'replay-detected'; jti: string };

export interface SeenJtiCache {
  seen(jti: string): Promise<boolean>;
  remember(jti: string, ttlSeconds: number): Promise<void>;
}

export class InMemoryJtiCache implements SeenJtiCache {
  private readonly store = new Map<string, number>();

  async seen(jti: string): Promise<boolean> {
    const exp = this.store.get(jti);
    if (exp === undefined) return false;
    if (exp < Math.floor(Date.now() / 1000)) {
      this.store.delete(jti);
      return false;
    }
    return true;
  }

  async remember(jti: string, ttlSeconds: number): Promise<void> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    this.store.set(jti, exp);
  }
}

export interface AuthenticateClientInput {
  readonly clientId: string;
  readonly clientAssertion: string;
  readonly expectedAudience: string;
}

export interface AuthenticateClientConfig {
  readonly replayTtlSeconds?: number;
}

export class AuthenticateClientUseCase {
  constructor(
    private readonly connectors: ConnectorRepository,
    private readonly clock: ClockPort,
    private readonly jtiCache: SeenJtiCache,
    private readonly config: AuthenticateClientConfig = {},
  ) {}

  async execute(input: AuthenticateClientInput): Promise<Result<{ connectorId: string; memberId: string }, AuthenticateClientError>> {
    const connector = await this.connectors.findByClientId(input.clientId);
    if (!connector) return err({ type: 'unknown-client' });
    if (connector.status !== 'active') return err({ type: 'connector-not-active' });

    const verified = await verifyClientAssertion(input.clientAssertion, connector.jwk as Jwk, {
      clientId: input.clientId,
      expectedAudience: input.expectedAudience,
      now: this.clock.nowUnix(),
    });
    if (!verified.ok) return err({ type: 'assertion-invalid', reason: verified.error.type });

    const jti = verified.value.jti;
    if (await this.jtiCache.seen(jti)) return err({ type: 'replay-detected', jti });
    const ttl = this.config.replayTtlSeconds ?? 600;
    await this.jtiCache.remember(jti, ttl);

    return ok({ connectorId: connector.id, memberId: connector.member_id });
  }
}
