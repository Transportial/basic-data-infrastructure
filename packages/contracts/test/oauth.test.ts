// SPDX-License-Identifier: Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  validateClientCredentialsRequest,
  CLIENT_ASSERTION_TYPE_JWT_BEARER,
} from '../src/oauth/client-credentials.ts';

const base = {
  grant_type: 'client_credentials',
  client_id: 'client-1',
  client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
  client_assertion: 'aaa.bbb.ccc',
};

describe('validateClientCredentialsRequest', () => {
  test('accepts minimal valid', () => {
    expect(validateClientCredentialsRequest(base).ok).toBe(true);
  });

  test('accepts optional scope + audience', () => {
    expect(
      validateClientCredentialsRequest({ ...base, scope: 'read:x', audience: 'a' }).ok,
    ).toBe(true);
  });

  test('rejects non-object', () => {
    expect(validateClientCredentialsRequest(null).ok).toBe(false);
  });

  test('rejects wrong grant_type', () => {
    expect(validateClientCredentialsRequest({ ...base, grant_type: 'password' }).ok).toBe(false);
  });

  test('rejects empty client_id', () => {
    expect(validateClientCredentialsRequest({ ...base, client_id: '' }).ok).toBe(false);
  });

  test('rejects missing client_id (non-string)', () => {
    expect(validateClientCredentialsRequest({ ...base, client_id: 1 }).ok).toBe(false);
  });

  test('rejects wrong assertion type', () => {
    expect(
      validateClientCredentialsRequest({ ...base, client_assertion_type: 'other' }).ok,
    ).toBe(false);
  });

  test('rejects non-string assertion', () => {
    expect(validateClientCredentialsRequest({ ...base, client_assertion: 1 }).ok).toBe(false);
  });

  test('rejects empty assertion', () => {
    expect(validateClientCredentialsRequest({ ...base, client_assertion: '' }).ok).toBe(false);
  });

  test('rejects non-string scope if present', () => {
    expect(validateClientCredentialsRequest({ ...base, scope: 42 }).ok).toBe(false);
  });

  test('rejects non-string audience if present', () => {
    expect(validateClientCredentialsRequest({ ...base, audience: 42 }).ok).toBe(false);
  });
});
