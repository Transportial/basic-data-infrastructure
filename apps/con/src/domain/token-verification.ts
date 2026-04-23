// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@bdi/kernel';
import type { BvadClaims, BvodClaims } from '@bdi/contracts';

export type ClockSkew = { readonly seconds: number };
export const DEFAULT_SKEW: ClockSkew = { seconds: 30 };

export type ValidationError =
  | { type: 'expired'; now: number; exp: number }
  | { type: 'not-yet-valid'; now: number; iat: number }
  | { type: 'wrong-issuer'; expected: string; actual: string }
  | { type: 'wrong-audience'; expected: string; actual: string | ReadonlyArray<string> }
  | { type: 'wrong-status'; status: string }
  | { type: 'wrong-association'; expected: string; actual: string }
  | { type: 'connector-mismatch'; expected: string; actual: string };

export interface BvadValidationContext {
  readonly now: number;
  readonly expectedIssuer: string;
  readonly expectedAudience: string;
  readonly expectedAssociation: string;
  readonly skew?: ClockSkew;
}

export function validateBvadTiming(
  claims: BvadClaims,
  ctx: BvadValidationContext,
): Result<BvadClaims, ValidationError> {
  const skew = ctx.skew?.seconds ?? DEFAULT_SKEW.seconds;
  if (ctx.now > claims.exp + skew) {
    return err({ type: 'expired', now: ctx.now, exp: claims.exp });
  }
  if (ctx.now + skew < claims.iat) {
    return err({ type: 'not-yet-valid', now: ctx.now, iat: claims.iat });
  }
  if (claims.iss !== ctx.expectedIssuer) {
    return err({ type: 'wrong-issuer', expected: ctx.expectedIssuer, actual: claims.iss });
  }
  if (!audienceMatches(claims.aud, ctx.expectedAudience)) {
    return err({ type: 'wrong-audience', expected: ctx.expectedAudience, actual: claims.aud });
  }
  if (claims['https://bdi.nl/claims/status'] !== 'active') {
    return err({ type: 'wrong-status', status: claims['https://bdi.nl/claims/status'] });
  }
  if (claims['https://bdi.nl/claims/association'] !== ctx.expectedAssociation) {
    return err({
      type: 'wrong-association',
      expected: ctx.expectedAssociation,
      actual: claims['https://bdi.nl/claims/association'],
    });
  }
  return ok(claims);
}

export interface BvodValidationContext {
  readonly now: number;
  readonly expectedIssuer: string;
  readonly expectedAudience: string;
  readonly subjectConnectorId: string;
  readonly skew?: ClockSkew;
}

export function validateBvodTiming(
  claims: BvodClaims,
  ctx: BvodValidationContext,
): Result<BvodClaims, ValidationError> {
  const skew = ctx.skew?.seconds ?? DEFAULT_SKEW.seconds;
  if (ctx.now > claims.exp + skew) {
    return err({ type: 'expired', now: ctx.now, exp: claims.exp });
  }
  if (ctx.now + skew < claims.iat) {
    return err({ type: 'not-yet-valid', now: ctx.now, iat: claims.iat });
  }
  if (claims.iss !== ctx.expectedIssuer) {
    return err({ type: 'wrong-issuer', expected: ctx.expectedIssuer, actual: claims.iss });
  }
  if (claims.aud !== ctx.expectedAudience) {
    return err({ type: 'wrong-audience', expected: ctx.expectedAudience, actual: claims.aud });
  }
  if (claims.sub !== ctx.subjectConnectorId) {
    return err({
      type: 'connector-mismatch',
      expected: ctx.subjectConnectorId,
      actual: claims.sub,
    });
  }
  return ok(claims);
}

function audienceMatches(actual: string | ReadonlyArray<string>, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected;
  return actual.includes(expected);
}
