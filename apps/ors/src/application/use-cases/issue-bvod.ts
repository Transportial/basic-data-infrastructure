// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  err,
  ok,
  type ChainContextId,
  type Euid,
  type Result,
} from '@transportial/kernel';
import {
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  BVOD_LIFETIME_SECONDS,
  type BvodClaims,
} from '@transportial/contracts';
import { effectiveRoles, isParty } from '../../domain/model/context-transitions.ts';
import type {
  ChainContextRepository,
  ClockPort,
  EventBusPort,
  IdPort,
  SignerPort,
} from '../ports.ts';

export type IssueBvodError =
  | { type: 'context-not-found'; id: ChainContextId }
  | { type: 'not-involved'; euid: Euid }
  | { type: 'context-not-active' };

export interface IssueBvodInput {
  readonly chain_context_id: ChainContextId;
  readonly subject_connector_id: string;
  readonly subject_euid: Euid;
  readonly audience: string;
}

export interface IssueBvodConfig {
  readonly issuer: string;
  readonly lifetimeSeconds?: number;
}

export class IssueBvodUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly signer: SignerPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly bus: EventBusPort,
    private readonly config: IssueBvodConfig,
  ) {}

  async execute(input: IssueBvodInput): Promise<Result<string, IssueBvodError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (ctx.status !== 'active' && ctx.status !== 'planned') {
      return err({ type: 'context-not-active' });
    }
    if (!isParty(ctx, input.subject_euid)) {
      return err({ type: 'not-involved', euid: input.subject_euid });
    }
    const roles = effectiveRoles(ctx, input.subject_euid);
    const now = this.clock.nowUnix();
    const lifetime = this.config.lifetimeSeconds ?? BVOD_LIFETIME_SECONDS;

    const claims: BvodClaims = {
      iss: this.config.issuer,
      sub: input.subject_connector_id,
      aud: input.audience,
      iat: now,
      exp: now + lifetime,
      jti: this.ids.newUuid(),
      [BVOD_CLAIM_ASSOCIATION]: ctx.association_id,
      [BVOD_CLAIM_CHAIN_CONTEXT]: {
        id: ctx.id,
        kind: ctx.kind,
        identifiers: ctx.identifiers,
      },
      [BVOD_CLAIM_INVOLVEMENT]: {
        member_euid: input.subject_euid,
        roles,
      },
      [BVOD_CLAIM_SCOPE]: scopeFromRoles(roles),
    };

    const jws = await this.signer.signJwt(claims);
    await this.bus.publish('ors.bvod.issued', ctx.association_id, {
      chain_context_id: ctx.id,
      subject: input.subject_connector_id,
      jti: claims.jti,
    });
    return ok(jws);
  }
}

// Translate abstract roles into least-privilege scopes. The mapping is
// intentionally simple and deterministic; operators with richer role catalogues
// swap in a configurable mapping without changing the use case.
const ROLE_SCOPES: Record<string, ReadonlyArray<string>> = {
  orchestrator: [
    'read:*',
    'write:context',
    'publish:event',
  ],
  carrier: ['read:eta', 'read:shipment', 'publish:event'],
  consignee: ['read:shipment'],
  shipper: ['read:shipment', 'read:eta'],
  terminal: ['read:container', 'publish:event'],
  customs: ['read:manifest'],
};

export function scopeFromRoles(roles: ReadonlyArray<string>): ReadonlyArray<string> {
  const out = new Set<string>();
  for (const r of roles) {
    const mapped = ROLE_SCOPES[r] ?? [];
    for (const s of mapped) out.add(s);
  }
  return [...out];
}
