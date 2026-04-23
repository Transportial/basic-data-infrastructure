// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Euid, type Result } from '@bdi/kernel';
import type {
  ChainContext,
  ChainContextStatus,
  Delegation,
  InvolvedParty,
  RolePerson,
} from './chain-context.ts';

export type ContextError =
  | { type: 'invalid-transition'; from: ChainContextStatus; to: ChainContextStatus }
  | { type: 'party-already-present'; euid: Euid }
  | { type: 'party-not-present'; euid: Euid }
  | { type: 'cannot-remove-orchestrator' }
  | { type: 'delegator-not-present'; euid: Euid }
  | { type: 'delegate-not-present'; euid: Euid }
  | { type: 'duplicate-pseudonym'; pseudonym: string };

export function addParty(
  ctx: ChainContext,
  party: InvolvedParty,
): Result<ChainContext, ContextError> {
  if (ctx.parties.some((p) => p.member_euid === party.member_euid)) {
    return err({ type: 'party-already-present', euid: party.member_euid });
  }
  return ok({ ...ctx, parties: [...ctx.parties, party] });
}

export function removeParty(
  ctx: ChainContext,
  euid: Euid,
): Result<ChainContext, ContextError> {
  if (euid === ctx.orchestrator_member_id) {
    return err({ type: 'cannot-remove-orchestrator' });
  }
  if (!ctx.parties.some((p) => p.member_euid === euid)) {
    return err({ type: 'party-not-present', euid });
  }
  return ok({
    ...ctx,
    parties: ctx.parties.filter((p) => p.member_euid !== euid),
  });
}

export function addDelegation(
  ctx: ChainContext,
  delegation: Delegation,
): Result<ChainContext, ContextError> {
  const parties = new Set(ctx.parties.map((p) => p.member_euid));
  if (!parties.has(delegation.delegator))
    return err({ type: 'delegator-not-present', euid: delegation.delegator });
  if (!parties.has(delegation.delegate))
    return err({ type: 'delegate-not-present', euid: delegation.delegate });
  return ok({ ...ctx, delegations: [...ctx.delegations, delegation] });
}

export function addRolePerson(
  ctx: ChainContext,
  person: RolePerson,
): Result<ChainContext, ContextError> {
  if (ctx.natural_persons.some((n) => n.pseudonym === person.pseudonym)) {
    return err({ type: 'duplicate-pseudonym', pseudonym: person.pseudonym });
  }
  return ok({ ...ctx, natural_persons: [...ctx.natural_persons, person] });
}

export function activateContext(ctx: ChainContext): Result<ChainContext, ContextError> {
  if (ctx.status !== 'planned') {
    return err({ type: 'invalid-transition', from: ctx.status, to: 'active' });
  }
  return ok({ ...ctx, status: 'active' });
}

export function completeContext(ctx: ChainContext): Result<ChainContext, ContextError> {
  if (ctx.status !== 'active') {
    return err({ type: 'invalid-transition', from: ctx.status, to: 'completed' });
  }
  return ok({ ...ctx, status: 'completed' });
}

export function cancelContext(ctx: ChainContext): Result<ChainContext, ContextError> {
  if (ctx.status === 'completed' || ctx.status === 'cancelled') {
    return err({ type: 'invalid-transition', from: ctx.status, to: 'cancelled' });
  }
  return ok({ ...ctx, status: 'cancelled' });
}

export function isParty(ctx: ChainContext, euid: Euid): boolean {
  return ctx.parties.some((p) => p.member_euid === euid);
}

export function partyRoles(ctx: ChainContext, euid: Euid): ReadonlyArray<string> {
  return ctx.parties.find((p) => p.member_euid === euid)?.roles ?? [];
}

export function effectiveRoles(ctx: ChainContext, euid: Euid): ReadonlyArray<string> {
  // A member's effective roles include their own declared roles plus any
  // scopes delegated to them from another party.
  const own = partyRoles(ctx, euid);
  const delegated = ctx.delegations
    .filter((d) => d.delegate === euid)
    .flatMap((d) => d.action_scope);
  return [...new Set([...own, ...delegated])];
}
