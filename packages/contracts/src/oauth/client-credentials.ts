// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
// Copyright (C) 2026 Stichting Connekt and contributors

import { ok, type Result } from '@bdi/kernel';
import { fail, isObject, type ValidationIssue } from '../validator.ts';

export const CLIENT_ASSERTION_TYPE_JWT_BEARER =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export interface ClientCredentialsRequest {
  readonly grant_type: 'client_credentials';
  readonly client_id: string;
  readonly client_assertion_type: typeof CLIENT_ASSERTION_TYPE_JWT_BEARER;
  readonly client_assertion: string;
  readonly scope?: string;
  readonly audience?: string;
}

export interface OAuthTokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly scope?: string;
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope';

export interface OAuthErrorResponse {
  readonly error: OAuthErrorCode;
  readonly error_description?: string;
}

export function validateClientCredentialsRequest(
  raw: unknown,
): Result<ClientCredentialsRequest, ValidationIssue[]> {
  if (!isObject(raw)) return fail([], 'not an object');
  const issues: ValidationIssue[] = [];
  if (raw.grant_type !== 'client_credentials')
    issues.push({ path: ['grant_type'], reason: 'must be client_credentials' });
  if (typeof raw.client_id !== 'string' || !raw.client_id)
    issues.push({ path: ['client_id'], reason: 'must be non-empty string' });
  if (raw.client_assertion_type !== CLIENT_ASSERTION_TYPE_JWT_BEARER)
    issues.push({ path: ['client_assertion_type'], reason: `must be ${CLIENT_ASSERTION_TYPE_JWT_BEARER}` });
  if (typeof raw.client_assertion !== 'string' || !raw.client_assertion)
    issues.push({ path: ['client_assertion'], reason: 'must be non-empty string' });
  if (raw.scope !== undefined && typeof raw.scope !== 'string')
    issues.push({ path: ['scope'], reason: 'must be string if present' });
  if (raw.audience !== undefined && typeof raw.audience !== 'string')
    issues.push({ path: ['audience'], reason: 'must be string if present' });
  if (issues.length > 0) return { ok: false, error: issues };
  return ok(raw as unknown as ClientCredentialsRequest);
}
