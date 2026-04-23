// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@bdi/kernel';
import {
  markVerified,
  recordVerification,
} from '../../domain/model/member-transitions.ts';
import type { VerificationResult } from '../../domain/model/member.ts';
import type {
  ClockPort,
  EventBusPort,
  MemberRepository,
  VerificationSource,
} from '../ports.ts';

export type RunVerificationsError =
  | { type: 'member-not-found'; id: string }
  | { type: 'bad-state'; status: string }
  | { type: 'no-verifications' };

export class RunVerificationsUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly sources: ReadonlyArray<VerificationSource>,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(memberId: string): Promise<Result<void, RunVerificationsError>> {
    const member = await this.members.find(memberId);
    if (!member) return err({ type: 'member-not-found', id: memberId });
    if (member.status !== 'draft') return err({ type: 'bad-state', status: member.status });

    let current = member;
    for (const source of this.sources) {
      const result = await source.verify({ euid: member.euid, legal_name: member.legal_name });
      const verification: VerificationResult = {
        source: source.name,
        outcome: result.outcome,
        verified_at: this.clock.nowIso(),
        evidence_hash: result.evidence_hash,
      };
      current = recordVerification(current, verification);
    }
    // Persist the recorded verifications even if the transition fails below,
    // so the audit trail is preserved for rerun.
    await this.members.save(current);

    if (current.verifications.length === 0) {
      return err({ type: 'no-verifications' });
    }

    const transitioned = markVerified(current, this.clock.nowIso());
    if (!transitioned.ok) {
      return err({ type: 'no-verifications' });
    }
    await this.members.save(transitioned.value);
    await this.bus.publish('asr.member.verified', member.association_id, {
      member_id: member.id,
      assurance_level: transitioned.value.assurance_level,
    });
    return ok(undefined);
  }
}
