// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type ChainContextId, type Euid, type Result } from '@bdi/kernel';
import { addRolePerson } from '../../domain/model/context-transitions.ts';
import { pseudonymise } from '../../domain/pseudonym.ts';
import type { RolePerson } from '../../domain/model/chain-context.ts';
import type {
  ChainContextRepository,
  ClockPort,
  EventBusPort,
} from '../ports.ts';

export type ManageNaturalPersonsError =
  | { type: 'context-not-found'; id: ChainContextId }
  | { type: 'not-a-party'; euid: Euid }
  | { type: 'duplicate-pseudonym'; pseudonym: string };

export interface AddRolePersonInput {
  readonly chain_context_id: ChainContextId;
  readonly actor: Euid;
  readonly organisation_euid: Euid;
  readonly personRef: string;
  readonly role: string;
  readonly salt: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
}

export class AddRolePersonUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: AddRolePersonInput,
  ): Promise<Result<{ pseudonym: string }, ManageNaturalPersonsError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (!ctx.parties.some((p) => p.member_euid === input.actor)) {
      return err({ type: 'not-a-party', euid: input.actor });
    }
    if (input.actor !== input.organisation_euid) {
      // Only the organisation's own party may add natural persons under it.
      return err({ type: 'not-a-party', euid: input.actor });
    }
    const pseudonym = await pseudonymise(input.organisation_euid, input.personRef, input.salt);
    const person: RolePerson = {
      pseudonym,
      role: input.role,
      organisation_euid: input.organisation_euid,
      valid_from: input.valid_from,
      valid_until: input.valid_until,
    };
    const next = addRolePerson(ctx, person);
    if (!next.ok) {
      return err({ type: 'duplicate-pseudonym', pseudonym });
    }
    await this.contexts.save(next.value);
    await this.bus.publish('ors.context.role-person-added', ctx.association_id, {
      chain_context_id: ctx.id,
      organisation_euid: input.organisation_euid,
      pseudonym,
      role: input.role,
    });
    void this.clock;
    return ok({ pseudonym });
  }
}

export interface ListRolePersonsInput {
  readonly chain_context_id: ChainContextId;
  readonly actor: Euid;
}

export class ListRolePersonsUseCase {
  constructor(private readonly contexts: ChainContextRepository) {}

  async execute(
    input: ListRolePersonsInput,
  ): Promise<Result<ReadonlyArray<RolePerson>, ManageNaturalPersonsError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (!ctx.parties.some((p) => p.member_euid === input.actor)) {
      return err({ type: 'not-a-party', euid: input.actor });
    }
    // The actor only sees natural persons that belong to them, plus those of
    // other parties with an explicit role-reading scope. In this reference
    // implementation we scope it strictly to the actor's own org — operators
    // with richer role hierarchies plug in a policy.
    return ok(ctx.natural_persons.filter((n) => n.organisation_euid === input.actor));
  }
}
