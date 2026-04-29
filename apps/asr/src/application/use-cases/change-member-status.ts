// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import { reinstate, revoke, suspend } from '../../domain/model/member-transitions.ts';
import type { ClockPort, EventBusPort, MemberRepository } from '../ports.ts';

export type ChangeStatusError =
  | { type: 'member-not-found'; id: string }
  | { type: 'invalid-transition'; from: string; to: string };

export type ChangeAction = 'suspend' | 'reinstate' | 'revoke';

export class ChangeMemberStatusUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    memberId: string,
    action: ChangeAction,
  ): Promise<Result<void, ChangeStatusError>> {
    const member = await this.members.find(memberId);
    if (!member) return err({ type: 'member-not-found', id: memberId });
    const now = this.clock.nowIso();
    const next =
      action === 'suspend'
        ? suspend(member, now)
        : action === 'reinstate'
          ? reinstate(member)
          : revoke(member, now);
    if (!next.ok) {
      if (next.error.type === 'invalid-transition') {
        return err({
          type: 'invalid-transition',
          from: next.error.from,
          to: next.error.to,
        });
      }
      return err({ type: 'invalid-transition', from: member.status, to: action });
    }
    await this.members.save(next.value);
    const eventType =
      action === 'suspend'
        ? 'asr.member.suspended'
        : action === 'reinstate'
          ? 'asr.member.activated'
          : 'asr.member.revoked';
    await this.bus.publish(eventType, member.association_id, {
      member_id: member.id,
      euid: member.euid,
    });
    return ok(undefined);
  }
}
