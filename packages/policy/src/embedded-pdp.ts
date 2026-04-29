// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PdpDecision, PdpInput, PolicyDecisionPoint } from './pdp.ts';

export type Effect = 'permit' | 'forbid';

export type Condition = (input: PdpInput) => boolean;

export interface Policy {
  readonly id: string;
  readonly effect: Effect;
  readonly actions?: ReadonlyArray<string> | '*';
  readonly resourceTypes?: ReadonlyArray<string> | '*';
  readonly when?: Condition;
  readonly reason?: string;
}

// Cedar-inspired decision rules:
// 1. If any forbid matches → deny.
// 2. Else if any permit matches → permit.
// 3. Else → deny with 'no-matching-policy'.
// This makes the policy set safe-by-default while keeping evaluation linear.
export class EmbeddedPdp implements PolicyDecisionPoint {
  constructor(private readonly policies: ReadonlyArray<Policy>) {}

  async decide(input: PdpInput): Promise<PdpDecision> {
    const matching = this.policies.filter((p) => matches(p, input));
    const forbid = matching.find((p) => p.effect === 'forbid');
    if (forbid) {
      return { effect: 'deny', reason: forbid.reason ?? `forbid:${forbid.id}` };
    }
    const permit = matching.find((p) => p.effect === 'permit');
    if (permit) {
      return { effect: 'permit' };
    }
    return { effect: 'deny', reason: 'no-matching-policy' };
  }
}

export function matches(policy: Policy, input: PdpInput): boolean {
  if (policy.actions && policy.actions !== '*' && !policy.actions.includes(input.action)) {
    return false;
  }
  if (
    policy.resourceTypes &&
    policy.resourceTypes !== '*' &&
    !policy.resourceTypes.includes(input.resource.type)
  ) {
    return false;
  }
  if (policy.when && !policy.when(input)) return false;
  return true;
}

export const conditions = {
  subjectActive: (): Condition => (i) => i.subject.status === 'active',
  minAssurance:
    (level: 'substantial' | 'high'): Condition =>
    (i) => {
      if (level === 'substantial') return true;
      return i.subject.assurance === 'high';
    },
  hasRole:
    (role: string): Condition =>
    (i) => i.context.roles.includes(role),
  resourceTagEquals:
    (tag: string, value: string): Condition =>
    (i) => i.resource.tags?.[tag] === value,
  and:
    (...cs: ReadonlyArray<Condition>): Condition =>
    (i) => cs.every((c) => c(i)),
  or:
    (...cs: ReadonlyArray<Condition>): Condition =>
    (i) => cs.some((c) => c(i)),
  not:
    (c: Condition): Condition =>
    (i) => !c(i),
};
