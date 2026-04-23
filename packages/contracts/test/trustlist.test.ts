// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
import { describe, test, expect } from 'bun:test';
import { validateTrustlist } from '../src/tokens/trustlist.ts';

const validEntry = {
  kid: 'asr-2026-01',
  'x5t#S256': 'abc',
  euid: 'NL.NHR.12345678',
  assurance: 'high',
  connector_id: 'urn:bdi:connector:x',
  jwk: { kty: 'OKP', crv: 'Ed25519', x: 'xx' },
  not_after: 9_999_999_999,
};

const base = {
  iss: 'https://asr.ctn.bdi.nl',
  aud: 'urn:bdi:association:ctn',
  iat: 1_700_000_000,
  version: 12,
  entries: [validEntry],
};

describe('validateTrustlist', () => {
  test('accepts valid list', () => {
    expect(validateTrustlist(base).ok).toBe(true);
  });

  test('rejects non-object', () => {
    expect(validateTrustlist(null).ok).toBe(false);
  });

  test('rejects bad version', () => {
    expect(validateTrustlist({ ...base, version: 0 }).ok).toBe(false);
    expect(validateTrustlist({ ...base, version: 'v1' }).ok).toBe(false);
  });

  test('rejects missing entries array', () => {
    expect(validateTrustlist({ ...base, entries: 'oops' }).ok).toBe(false);
  });

  test('rejects non-object entry', () => {
    expect(validateTrustlist({ ...base, entries: ['x'] }).ok).toBe(false);
  });

  test('rejects bad entry fields', () => {
    const r = validateTrustlist({
      ...base,
      entries: [{ ...validEntry, kid: 1, assurance: 'low', not_after: 'never', jwk: 'x' }],
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad iss/aud/iat types', () => {
    expect(validateTrustlist({ ...base, iss: 1, aud: 1, iat: 'x' }).ok).toBe(false);
  });
});
