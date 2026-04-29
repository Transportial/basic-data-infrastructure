// SPDX-License-Identifier: Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { ok, type Result } from '@transportial/kernel';
import { fail, isObject, type ValidationIssue } from '../validator.ts';

export const BVOD_LIFETIME_SECONDS = 3600;
export const BVOD_CLAIM_ASSOCIATION = 'https://bdi.nl/claims/association';
export const BVOD_CLAIM_CHAIN_CONTEXT = 'https://bdi.nl/claims/chain_context';
export const BVOD_CLAIM_INVOLVEMENT = 'https://bdi.nl/claims/involvement';
export const BVOD_CLAIM_SCOPE = 'https://bdi.nl/claims/scope';

export type ChainContextKind = 'order' | 'transport' | 'shipment' | 'custom';

export interface BvodClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly [BVOD_CLAIM_ASSOCIATION]: string;
  readonly [BVOD_CLAIM_CHAIN_CONTEXT]: {
    readonly id: string;
    readonly kind: ChainContextKind;
    readonly identifiers: ReadonlyArray<{ readonly scheme: string; readonly value: string }>;
  };
  readonly [BVOD_CLAIM_INVOLVEMENT]: {
    readonly member_euid: string;
    readonly roles: ReadonlyArray<string>;
    readonly delegated_from?: string;
  };
  readonly [BVOD_CLAIM_SCOPE]: ReadonlyArray<string>;
}

export function validateBvodClaims(raw: unknown): Result<BvodClaims, ValidationIssue[]> {
  if (!isObject(raw)) return fail([], 'not an object');
  const issues: ValidationIssue[] = [];
  const add = (cond: boolean, path: (string | number)[], msg: string) => {
    if (!cond) issues.push({ path, reason: msg });
  };

  add(typeof raw.iss === 'string', ['iss'], 'must be string');
  add(typeof raw.sub === 'string', ['sub'], 'must be string');
  add(typeof raw.aud === 'string', ['aud'], 'must be string');
  add(Number.isInteger(raw.iat), ['iat'], 'must be integer');
  add(Number.isInteger(raw.exp), ['exp'], 'must be integer');
  add(typeof raw.jti === 'string', ['jti'], 'must be string');
  add(typeof raw[BVOD_CLAIM_ASSOCIATION] === 'string', [BVOD_CLAIM_ASSOCIATION], 'must be string');

  const ctx = raw[BVOD_CLAIM_CHAIN_CONTEXT];
  if (!isObject(ctx)) {
    issues.push({ path: [BVOD_CLAIM_CHAIN_CONTEXT], reason: 'must be object' });
  } else {
    add(typeof ctx.id === 'string', [BVOD_CLAIM_CHAIN_CONTEXT, 'id'], 'must be string');
    add(
      ctx.kind === 'order' || ctx.kind === 'transport' || ctx.kind === 'shipment' || ctx.kind === 'custom',
      [BVOD_CLAIM_CHAIN_CONTEXT, 'kind'],
      'must be order|transport|shipment|custom',
    );
    if (!Array.isArray(ctx.identifiers)) {
      issues.push({ path: [BVOD_CLAIM_CHAIN_CONTEXT, 'identifiers'], reason: 'must be array' });
    } else {
      ctx.identifiers.forEach((i, idx) => {
        if (!isObject(i)) {
          issues.push({
            path: [BVOD_CLAIM_CHAIN_CONTEXT, 'identifiers', idx],
            reason: 'must be object',
          });
        } else {
          add(
            typeof i.scheme === 'string',
            [BVOD_CLAIM_CHAIN_CONTEXT, 'identifiers', idx, 'scheme'],
            'must be string',
          );
          add(
            typeof i.value === 'string',
            [BVOD_CLAIM_CHAIN_CONTEXT, 'identifiers', idx, 'value'],
            'must be string',
          );
        }
      });
    }
  }

  const inv = raw[BVOD_CLAIM_INVOLVEMENT];
  if (!isObject(inv)) {
    issues.push({ path: [BVOD_CLAIM_INVOLVEMENT], reason: 'must be object' });
  } else {
    add(typeof inv.member_euid === 'string', [BVOD_CLAIM_INVOLVEMENT, 'member_euid'], 'must be string');
    add(
      Array.isArray(inv.roles) && (inv.roles as unknown[]).every((r) => typeof r === 'string'),
      [BVOD_CLAIM_INVOLVEMENT, 'roles'],
      'must be string[]',
    );
    if (inv.delegated_from !== undefined && typeof inv.delegated_from !== 'string') {
      issues.push({
        path: [BVOD_CLAIM_INVOLVEMENT, 'delegated_from'],
        reason: 'must be string if present',
      });
    }
  }

  add(
    Array.isArray(raw[BVOD_CLAIM_SCOPE]) &&
      (raw[BVOD_CLAIM_SCOPE] as unknown[]).every((s) => typeof s === 'string'),
    [BVOD_CLAIM_SCOPE],
    'must be string[]',
  );

  if (issues.length > 0) return { ok: false, error: issues };
  return ok(raw as unknown as BvodClaims);
}
