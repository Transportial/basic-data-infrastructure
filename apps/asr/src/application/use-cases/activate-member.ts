// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import { activate } from '../../domain/model/member-transitions.ts';
import { approve, isComplete } from '../../domain/model/four-eyes.ts';
import type { FourEyesApproval } from '../../domain/model/four-eyes.ts';
import type {
  ApprovalRepository,
  ClockPort,
  EventBusPort,
  IdPort,
  MemberRepository,
} from '../ports.ts';

export type ActivateMemberError =
  | { type: 'member-not-found'; id: string }
  | { type: 'already-active' }
  | { type: 'not-verified'; status: string }
  | { type: 'self-approval-forbidden'; by: string }
  | { type: 'missing-signing-representative' };

export interface ActivateMemberInput {
  readonly memberId: string;
  readonly approver: string;
}

export interface ActivateMemberOutput {
  readonly state: 'awaiting-second-approval' | 'activated';
}

export class ActivateMemberUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly approvals: ApprovalRepository,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: ActivateMemberInput,
  ): Promise<Result<ActivateMemberOutput, ActivateMemberError>> {
    const member = await this.members.find(input.memberId);
    if (!member) return err({ type: 'member-not-found', id: input.memberId });
    if (member.status === 'activated') return err({ type: 'already-active' });
    if (member.status !== 'verified')
      return err({ type: 'not-verified', status: member.status });

    let approval = await this.approvals.findBySubject('member_activation', member.id);
    if (!approval) {
      approval = {
        id: this.ids.newUuid(),
        subject_type: 'member_activation',
        subject_id: member.id,
        state: 'pending',
        first_approval: null,
        second_approval: null,
        created_at: this.clock.nowIso(),
      } satisfies FourEyesApproval;
    }

    const approved = approve(approval, input.approver, this.clock.nowIso());
    if (!approved.ok) {
      if (approved.error.type === 'self-approval-forbidden') {
        return err(approved.error);
      }
      // other forms shouldn't happen in this path
      return err({ type: 'not-verified', status: approval.state });
    }
    await this.approvals.save(approved.value);

    if (!isComplete(approved.value)) {
      return ok({ state: 'awaiting-second-approval' });
    }

    const activated = activate(member, this.clock.nowIso());
    if (!activated.ok) {
      if (activated.error.type === 'missing-signing-representative') {
        return err({ type: 'missing-signing-representative' });
      }
      return err({ type: 'not-verified', status: member.status });
    }
    await this.members.save(activated.value);
    await this.bus.publish('asr.member.activated', member.association_id, {
      member_id: member.id,
      euid: member.euid,
    });
    return ok({ state: 'activated' });
  }
}
