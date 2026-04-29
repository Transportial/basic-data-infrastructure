// SPDX-License-Identifier: Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { ok, type Result } from '@transportial/kernel';
import { fail, isObject, type ValidationIssue } from '../validator.ts';

export interface TrustlistEntry {
  readonly kid: string;
  readonly 'x5t#S256': string;
  readonly euid: string;
  readonly assurance: 'substantial' | 'high';
  readonly connector_id: string;
  readonly jwk: Readonly<Record<string, unknown>>;
  readonly not_after: number;
}

export interface Trustlist {
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly version: number;
  readonly entries: ReadonlyArray<TrustlistEntry>;
}

export function validateTrustlist(raw: unknown): Result<Trustlist, ValidationIssue[]> {
  if (!isObject(raw)) return fail([], 'not an object');
  const issues: ValidationIssue[] = [];
  const add = (cond: boolean, path: (string | number)[], msg: string) => {
    if (!cond) issues.push({ path, reason: msg });
  };
  add(typeof raw.iss === 'string', ['iss'], 'must be string');
  add(typeof raw.aud === 'string', ['aud'], 'must be string');
  add(Number.isInteger(raw.iat), ['iat'], 'must be integer');
  add(Number.isInteger(raw.version) && (raw.version as number) >= 1, ['version'], 'must be positive integer');
  if (!Array.isArray(raw.entries)) {
    issues.push({ path: ['entries'], reason: 'must be array' });
  } else {
    raw.entries.forEach((e, i) => {
      if (!isObject(e)) {
        issues.push({ path: ['entries', i], reason: 'must be object' });
        return;
      }
      add(typeof e.kid === 'string', ['entries', i, 'kid'], 'must be string');
      add(typeof e['x5t#S256'] === 'string', ['entries', i, 'x5t#S256'], 'must be string');
      add(typeof e.euid === 'string', ['entries', i, 'euid'], 'must be string');
      add(e.assurance === 'substantial' || e.assurance === 'high', ['entries', i, 'assurance'], 'must be substantial|high');
      add(typeof e.connector_id === 'string', ['entries', i, 'connector_id'], 'must be string');
      add(isObject(e.jwk), ['entries', i, 'jwk'], 'must be object');
      add(Number.isInteger(e.not_after), ['entries', i, 'not_after'], 'must be integer');
    });
  }
  if (issues.length > 0) return { ok: false, error: issues };
  return ok(raw as unknown as Trustlist);
}
