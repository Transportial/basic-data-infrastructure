// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import type { AssuranceLevel, Member, MemberStatus, VerificationResult } from './member.ts';

export type MemberTransitionError =
  | { type: 'invalid-transition'; from: MemberStatus; to: MemberStatus }
  | { type: 'no-verifications' }
  | { type: 'missing-signing-representative' };

export function recordVerification(
  member: Member,
  verification: VerificationResult,
): Member {
  return { ...member, verifications: [...member.verifications, verification] };
}

export function computeAssuranceLevel(
  verifications: ReadonlyArray<VerificationResult>,
): AssuranceLevel | null {
  const successes = verifications.filter((v) => v.outcome === 'success');
  if (successes.length === 0) return null;
  // 'high' when either eHerkenning or at least two independent authoritative registers succeeded.
  const hasEHerkenning = successes.some((v) => v.source === 'eHerkenning');
  const registrySources = successes.filter((v) =>
    ['KvK', 'KBO', 'GLEIF', 'VIES'].includes(v.source),
  );
  if (hasEHerkenning || registrySources.length >= 2) return 'high';
  return 'substantial';
}

export function markVerified(member: Member, now: string): Result<Member, MemberTransitionError> {
  if (member.status !== 'draft') {
    return err({ type: 'invalid-transition', from: member.status, to: 'verified' });
  }
  if (member.verifications.length === 0) {
    return err({ type: 'no-verifications' });
  }
  const assurance = computeAssuranceLevel(member.verifications);
  return ok({
    ...member,
    status: 'verified',
    assurance_level: assurance,
    // verified timestamp is implicit in status; members_updated events capture this
    created_at: member.created_at,
    activated_at: null,
    suspended_at: null,
    revoked_at: null,
    // Ensure 'now' is retained by callers via events, not directly stored here
  } satisfies Member);
  void now;
}

export function activate(member: Member, now: string): Result<Member, MemberTransitionError> {
  if (member.status !== 'verified') {
    return err({ type: 'invalid-transition', from: member.status, to: 'activated' });
  }
  if (!member.signing_representative) {
    return err({ type: 'missing-signing-representative' });
  }
  return ok({ ...member, status: 'activated', activated_at: now });
}

export function suspend(member: Member, now: string): Result<Member, MemberTransitionError> {
  if (member.status !== 'activated') {
    return err({ type: 'invalid-transition', from: member.status, to: 'suspended' });
  }
  return ok({ ...member, status: 'suspended', suspended_at: now });
}

export function reinstate(member: Member): Result<Member, MemberTransitionError> {
  if (member.status !== 'suspended') {
    return err({ type: 'invalid-transition', from: member.status, to: 'activated' });
  }
  return ok({ ...member, status: 'activated', suspended_at: null });
}

export function revoke(member: Member, now: string): Result<Member, MemberTransitionError> {
  if (member.status === 'revoked' || member.status === 'draft') {
    return err({ type: 'invalid-transition', from: member.status, to: 'revoked' });
  }
  return ok({ ...member, status: 'revoked', revoked_at: now });
}

export function isOperational(member: Member): boolean {
  return member.status === 'activated';
}
