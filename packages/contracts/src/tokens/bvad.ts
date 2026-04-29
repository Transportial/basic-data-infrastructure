// SPDX-License-Identifier: Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { ok, type Result } from '@bdi/kernel';
import { fail, isObject, type ValidationIssue } from '../validator.ts';

export const BVAD_LIFETIME_SECONDS = 600;
export const BVAD_CLAIM_ASSOCIATION = 'https://bdi.nl/claims/association';
export const BVAD_CLAIM_ORGANISATION = 'https://bdi.nl/claims/organisation';
export const BVAD_CLAIM_CONNECTOR = 'https://bdi.nl/claims/connector';
export const BVAD_CLAIM_ASSURANCE = 'https://bdi.nl/claims/assurance';
export const BVAD_CLAIM_STATUS = 'https://bdi.nl/claims/status';

export type AssuranceLevel = 'substantial' | 'high';
export type AssuranceSource =
  | 'KvK'
  | 'KBO'
  | 'GLEIF'
  | 'VIES'
  | 'eHerkenning'
  | 'manual';
export type MemberOperationalStatus = 'active' | 'suspended' | 'revoked';

export interface BvadClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | ReadonlyArray<string>;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly [BVAD_CLAIM_ASSOCIATION]: string;
  readonly [BVAD_CLAIM_ORGANISATION]: {
    readonly euid: string;
    readonly legal_name: string;
    readonly vat?: string;
    readonly lei?: string;
  };
  readonly [BVAD_CLAIM_CONNECTOR]: {
    readonly id: string;
    readonly x5t_s256: string;
    readonly bound_on: number;
    readonly authorised_by: string;
  };
  readonly [BVAD_CLAIM_ASSURANCE]: {
    readonly level: AssuranceLevel;
    readonly sources: ReadonlyArray<AssuranceSource>;
  };
  readonly [BVAD_CLAIM_STATUS]: MemberOperationalStatus;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBvadClaims(
  raw: unknown,
): Result<BvadClaims, ValidationIssue[]> {
  if (!isObject(raw)) return fail([], 'not an object');
  const issues: ValidationIssue[] = [];
  const check = <T>(cond: boolean, path: (string | number)[], msg: string, value: T) => {
    if (!cond) issues.push({ path, reason: msg });
    return value;
  };

  check(typeof raw.iss === 'string', ['iss'], 'must be string', null);
  check(typeof raw.sub === 'string', ['sub'], 'must be string', null);
  check(
    typeof raw.aud === 'string' || (Array.isArray(raw.aud) && raw.aud.every((a) => typeof a === 'string')),
    ['aud'],
    'must be string or string[]',
    null,
  );
  check(Number.isInteger(raw.iat), ['iat'], 'must be integer', null);
  check(Number.isInteger(raw.exp), ['exp'], 'must be integer', null);
  check(typeof raw.jti === 'string' && UUID_RE.test(raw.jti as string), ['jti'], 'must be UUID', null);

  check(typeof raw[BVAD_CLAIM_ASSOCIATION] === 'string', [BVAD_CLAIM_ASSOCIATION], 'must be string', null);

  const org = raw[BVAD_CLAIM_ORGANISATION];
  if (!isObject(org)) {
    issues.push({ path: [BVAD_CLAIM_ORGANISATION], reason: 'must be object' });
  } else {
    check(typeof org.euid === 'string', [BVAD_CLAIM_ORGANISATION, 'euid'], 'must be string', null);
    check(typeof org.legal_name === 'string', [BVAD_CLAIM_ORGANISATION, 'legal_name'], 'must be string', null);
    if (org.vat !== undefined && typeof org.vat !== 'string') {
      issues.push({ path: [BVAD_CLAIM_ORGANISATION, 'vat'], reason: 'must be string if present' });
    }
    if (org.lei !== undefined && typeof org.lei !== 'string') {
      issues.push({ path: [BVAD_CLAIM_ORGANISATION, 'lei'], reason: 'must be string if present' });
    }
  }

  const con = raw[BVAD_CLAIM_CONNECTOR];
  if (!isObject(con)) {
    issues.push({ path: [BVAD_CLAIM_CONNECTOR], reason: 'must be object' });
  } else {
    check(typeof con.id === 'string', [BVAD_CLAIM_CONNECTOR, 'id'], 'must be string', null);
    check(typeof con.x5t_s256 === 'string', [BVAD_CLAIM_CONNECTOR, 'x5t_s256'], 'must be string', null);
    check(Number.isInteger(con.bound_on), [BVAD_CLAIM_CONNECTOR, 'bound_on'], 'must be integer', null);
    check(typeof con.authorised_by === 'string', [BVAD_CLAIM_CONNECTOR, 'authorised_by'], 'must be string', null);
  }

  const ass = raw[BVAD_CLAIM_ASSURANCE];
  if (!isObject(ass)) {
    issues.push({ path: [BVAD_CLAIM_ASSURANCE], reason: 'must be object' });
  } else {
    check(
      ass.level === 'substantial' || ass.level === 'high',
      [BVAD_CLAIM_ASSURANCE, 'level'],
      'must be substantial|high',
      null,
    );
    check(
      Array.isArray(ass.sources) && (ass.sources as unknown[]).every((s) => typeof s === 'string'),
      [BVAD_CLAIM_ASSURANCE, 'sources'],
      'must be string[]',
      null,
    );
  }

  const status = raw[BVAD_CLAIM_STATUS];
  check(
    status === 'active' || status === 'suspended' || status === 'revoked',
    [BVAD_CLAIM_STATUS],
    'must be active|suspended|revoked',
    null,
  );

  if (issues.length > 0) return { ok: false, error: issues };
  return ok(raw as unknown as BvadClaims);
}
