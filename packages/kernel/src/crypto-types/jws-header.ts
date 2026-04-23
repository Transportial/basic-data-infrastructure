// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Result } from '../result.ts';

export const BDI_PROFILE_VERSION_HEADER = 'https://bdi.nl/v';

export const BDI_ALLOWED_ALGS = ['EdDSA', 'ES256', 'ES384', 'PS256'] as const;
export type BdiAllowedAlg = (typeof BDI_ALLOWED_ALGS)[number];

export interface BdiJwsHeader {
  alg: BdiAllowedAlg;
  kid: string;
  typ?: string;
  x5t?: string;
  'x5t#S256'?: string;
  x5c?: string[];
  'https://bdi.nl/v': 1;
  crit?: string[];
}

export type HeaderValidationError =
  | { type: 'empty' }
  | { type: 'missing-alg' }
  | { type: 'disallowed-alg'; alg: string }
  | { type: 'missing-kid' }
  | { type: 'missing-profile-version' }
  | { type: 'missing-crit-profile' };

export function validateBdiJwsHeader(raw: unknown): Result<BdiJwsHeader, HeaderValidationError> {
  if (!raw || typeof raw !== 'object') return err({ type: 'empty' });
  const h = raw as Record<string, unknown>;
  if (typeof h.alg !== 'string') return err({ type: 'missing-alg' });
  if (!(BDI_ALLOWED_ALGS as readonly string[]).includes(h.alg))
    return err({ type: 'disallowed-alg', alg: h.alg });
  if (typeof h.kid !== 'string' || h.kid.length === 0) return err({ type: 'missing-kid' });
  if (h[BDI_PROFILE_VERSION_HEADER] !== 1) return err({ type: 'missing-profile-version' });
  const crit = Array.isArray(h.crit) ? (h.crit as string[]) : undefined;
  if (!crit || !crit.includes(BDI_PROFILE_VERSION_HEADER))
    return err({ type: 'missing-crit-profile' });
  return ok(h as unknown as BdiJwsHeader);
}
