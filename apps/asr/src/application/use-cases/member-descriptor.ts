// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Euid, type Result } from '@transportial/kernel';
import type { ClockPort, EventBusPort, IdPort, MemberRepository, SignerPort } from '../ports.ts';

export type MemberDescriptorError = { type: 'member-not-found'; euid: Euid };

export interface MemberDescriptorConfig {
  readonly issuer: string;
  readonly lifetimeSeconds?: number;
}

// Signed, short-lived public descriptor of a member's state. Publishable via
// `GET /.well-known/bdi/members/{euid}`; consumers use it to learn an EUID's
// current operational status, assurance level, and authoritative register
// sources without having to authenticate.
export class BuildMemberDescriptorUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly signer: SignerPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly bus: EventBusPort,
    private readonly config: MemberDescriptorConfig,
  ) {}

  async execute(euid: Euid): Promise<Result<string, MemberDescriptorError>> {
    const member = await this.members.findByEuid(euid);
    if (!member) return err({ type: 'member-not-found', euid });
    const now = this.clock.nowUnix();
    const lifetime = this.config.lifetimeSeconds ?? 24 * 3600;
    const claims = {
      iss: this.config.issuer,
      sub: member.euid,
      iat: now,
      exp: now + lifetime,
      jti: this.ids.newUuid(),
      'https://bdi.nl/claims/organisation': {
        euid: member.euid,
        legal_name: member.legal_name,
        ...(member.vat_number !== undefined ? { vat: member.vat_number } : {}),
        ...(member.lei !== undefined ? { lei: member.lei } : {}),
      },
      'https://bdi.nl/claims/assurance': {
        level: member.assurance_level ?? 'substantial',
        sources: member.verifications.filter((v) => v.outcome === 'success').map((v) => v.source),
      },
      'https://bdi.nl/claims/association': member.association_id,
      'https://bdi.nl/claims/status':
        member.status === 'activated'
          ? 'active'
          : member.status === 'suspended'
            ? 'suspended'
            : member.status === 'revoked'
              ? 'revoked'
              : 'pending',
      'https://bdi.nl/claims/votes': member.votes_in_association,
    };
    const jws = await this.signer.signJwt(claims);
    await this.bus.publish('asr.member.descriptor-issued', member.association_id, {
      euid: member.euid,
      jti: claims.jti,
    });
    return ok(jws);
  }
}
