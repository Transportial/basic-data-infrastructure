// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import {
  err,
  ok,
  type ChainContextId,
  type Euid,
  type Result,
} from '@bdi/kernel';
import {
  addParty,
  addDelegation,
  removeParty,
} from '../../domain/model/context-transitions.ts';
import type {
  Delegation,
  InvolvedParty,
} from '../../domain/model/chain-context.ts';
import type {
  ChainContextRepository,
  ClockPort,
  EventBusPort,
} from '../ports.ts';

import type { ContextError } from '../../domain/model/context-transitions.ts';

export type ManagePartiesError =
  | { type: 'context-not-found'; id: ChainContextId }
  | { type: 'not-authorised'; actor: Euid }
  | ContextError;

export interface AddPartyInput {
  readonly chain_context_id: ChainContextId;
  readonly actor: Euid;
  readonly member_euid: Euid;
  readonly roles: ReadonlyArray<string>;
  readonly valid_from: string;
  readonly valid_until: string | null;
}

export class AddPartyUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(input: AddPartyInput): Promise<Result<void, ManagePartiesError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (input.actor !== ctx.orchestrator_member_id) {
      return err({ type: 'not-authorised', actor: input.actor });
    }
    const party: InvolvedParty = {
      member_euid: input.member_euid,
      roles: input.roles,
      added_at: this.clock.nowIso(),
      added_by_member: input.actor,
      valid_from: input.valid_from,
      valid_until: input.valid_until,
    };
    const next = addParty(ctx, party);
    if (!next.ok) return err(next.error);
    await this.contexts.save(next.value);
    await this.bus.publish('ors.context.party-added', ctx.association_id, {
      chain_context_id: ctx.id,
      member_euid: input.member_euid,
    });
    return ok(undefined);
  }
}

export interface RemovePartyInput {
  readonly chain_context_id: ChainContextId;
  readonly actor: Euid;
  readonly member_euid: Euid;
}

export class RemovePartyUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly bus: EventBusPort,
  ) {}

  async execute(input: RemovePartyInput): Promise<Result<void, ManagePartiesError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (input.actor !== ctx.orchestrator_member_id) {
      return err({ type: 'not-authorised', actor: input.actor });
    }
    const next = removeParty(ctx, input.member_euid);
    if (!next.ok) return err(next.error);
    await this.contexts.save(next.value);
    await this.bus.publish('ors.context.party-removed', ctx.association_id, {
      chain_context_id: ctx.id,
      member_euid: input.member_euid,
    });
    return ok(undefined);
  }
}

export interface AddDelegationInput {
  readonly chain_context_id: ChainContextId;
  readonly actor: Euid;
  readonly delegator: Euid;
  readonly delegate: Euid;
  readonly action_scope: ReadonlyArray<string>;
  readonly valid_until: string | null;
}

export class AddDelegationUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(input: AddDelegationInput): Promise<Result<void, ManagePartiesError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    // Only the delegator itself may delegate their scope, plus the orchestrator as a backstop.
    if (input.actor !== input.delegator && input.actor !== ctx.orchestrator_member_id) {
      return err({ type: 'not-authorised', actor: input.actor });
    }
    const delegation: Delegation = {
      delegator: input.delegator,
      delegate: input.delegate,
      action_scope: input.action_scope,
      valid_until: input.valid_until,
      authorised_at: this.clock.nowIso(),
    };
    const next = addDelegation(ctx, delegation);
    if (!next.ok) return err(next.error);
    await this.contexts.save(next.value);
    await this.bus.publish('ors.context.delegation-added', ctx.association_id, {
      chain_context_id: ctx.id,
      delegator: input.delegator,
      delegate: input.delegate,
    });
    return ok(undefined);
  }
}
