// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVAD_LIFETIME_SECONDS,
  type BvadClaims,
} from '@transportial/contracts';
import type {
  ClockPort,
  ConnectorRepository,
  EventBusPort,
  IdPort,
  MemberRepository,
  SignerPort,
} from '../ports.ts';
import {
  hashClaims,
  type IssuedTokensJournal,
} from './issued-tokens-journal.ts';

export type IssueBvadError =
  | { type: 'unknown-client' }
  | { type: 'connector-not-active' }
  | { type: 'member-not-activated' };

export interface IssueBvadInput {
  readonly clientId: string;
  readonly audience: string;
}

export interface IssueBvadConfig {
  readonly issuer: string;
  readonly lifetimeSeconds?: number;
}

export class IssueBvadUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly connectors: ConnectorRepository,
    private readonly signer: SignerPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly bus: EventBusPort,
    private readonly journal: IssuedTokensJournal,
    private readonly config: IssueBvadConfig,
  ) {}

  async execute(input: IssueBvadInput): Promise<Result<string, IssueBvadError>> {
    const connector = await this.connectors.findByClientId(input.clientId);
    if (!connector) return err({ type: 'unknown-client' });
    if (connector.status !== 'active') return err({ type: 'connector-not-active' });

    const member = await this.members.find(connector.member_id);
    if (!member || member.status !== 'activated') return err({ type: 'member-not-activated' });

    const now = this.clock.nowUnix();
    const lifetime = this.config.lifetimeSeconds ?? BVAD_LIFETIME_SECONDS;

    const claims: BvadClaims = {
      iss: this.config.issuer,
      sub: connector.id,
      aud: input.audience,
      iat: now,
      exp: now + lifetime,
      jti: this.ids.newUuid(),
      [BVAD_CLAIM_ASSOCIATION]: member.association_id,
      [BVAD_CLAIM_ORGANISATION]: {
        euid: member.euid,
        legal_name: member.legal_name,
        ...(member.vat_number !== undefined ? { vat: member.vat_number } : {}),
        ...(member.lei !== undefined ? { lei: member.lei } : {}),
      },
      [BVAD_CLAIM_CONNECTOR]: {
        id: connector.id,
        x5t_s256: connector.cert_thumbprint,
        bound_on: connector.bound_on,
        authorised_by: connector.authorised_by,
      },
      [BVAD_CLAIM_ASSURANCE]: {
        level: member.assurance_level ?? 'substantial',
        sources: member.verifications
          .filter((v) => v.outcome === 'success')
          .map((v) => v.source),
      },
      [BVAD_CLAIM_STATUS]: 'active',
    };

    const jws = await this.signer.signJwt(claims);
    const claimsHash = await hashClaims(claims);
    await this.journal.record({
      jti: claims.jti,
      token_type: 'bvad',
      issued_to: connector.id,
      issued_at: this.clock.nowIso(),
      expires_at: new Date((now + lifetime) * 1000).toISOString(),
      claims_hash: claimsHash,
    });
    await this.bus.publish('asr.bvad.issued', member.association_id, {
      jti: claims.jti,
      sub: claims.sub,
    });
    return ok(jws);
  }
}
