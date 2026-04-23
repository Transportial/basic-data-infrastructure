// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type AssociationId, type Euid, type Result } from '@bdi/kernel';
import { createDraftMember, type SigningRepresentative } from '../../domain/model/member.ts';
import type { ClockPort, EventBusPort, IdPort, MemberRepository } from '../ports.ts';

export interface StartOnboardingInput {
  readonly euid: Euid;
  readonly association_id: AssociationId;
  readonly legal_name: string;
  readonly vat_number?: string;
  readonly lei?: string;
  readonly signing_representative: SigningRepresentative | null;
}

export type StartOnboardingError =
  | { type: 'already-registered'; euid: Euid };

export interface StartOnboardingOutput {
  readonly memberId: string;
}

export class StartOnboardingUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: StartOnboardingInput,
  ): Promise<Result<StartOnboardingOutput, StartOnboardingError>> {
    const existing = await this.members.findByEuid(input.euid);
    if (existing) return err({ type: 'already-registered', euid: input.euid });

    const draft = createDraftMember({
      id: this.ids.newUuid(),
      association_id: input.association_id,
      euid: input.euid,
      legal_name: input.legal_name,
      ...(input.vat_number !== undefined ? { vat_number: input.vat_number } : {}),
      ...(input.lei !== undefined ? { lei: input.lei } : {}),
      signing_representative: input.signing_representative,
      created_at: this.clock.nowIso(),
    });

    await this.members.save(draft);
    await this.bus.publish('asr.member.draft-created', input.association_id, {
      member_id: draft.id,
      euid: draft.euid,
    });

    return ok({ memberId: draft.id });
  }
}
