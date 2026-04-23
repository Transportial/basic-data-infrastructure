// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
import { describe, test, expect } from 'bun:test';
import {
  validateBvadClaims,
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_STATUS,
  BVAD_LIFETIME_SECONDS,
} from '../src/tokens/bvad.ts';

const base = {
  iss: 'https://asr.ctn.bdi.nl',
  sub: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
  aud: 'urn:bdi:association:ctn',
  iat: 1_700_000_000,
  exp: 1_700_000_600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.12345678', legal_name: 'Acme BV' },
  [BVAD_CLAIM_CONNECTOR]: {
    id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
    x5t_s256: 'abc',
    bound_on: 1_700_000_000,
    authorised_by: 'rep-1',
  },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

describe('validateBvadClaims', () => {
  test('lifetime constant is 10 minutes', () => {
    expect(BVAD_LIFETIME_SECONDS).toBe(600);
  });

  test('accepts valid claims', () => {
    const r = validateBvadClaims(base);
    expect(r.ok).toBe(true);
  });

  test('accepts aud as array', () => {
    const r = validateBvadClaims({ ...base, aud: ['a', 'b'] });
    expect(r.ok).toBe(true);
  });

  test('rejects non-object', () => {
    expect(validateBvadClaims(null).ok).toBe(false);
    expect(validateBvadClaims(42).ok).toBe(false);
  });

  test('rejects bad iss', () => {
    const r = validateBvadClaims({ ...base, iss: 123 });
    expect(!r.ok && r.error.some((e) => e.path[0] === 'iss')).toBe(true);
  });

  test('rejects bad sub', () => {
    const r = validateBvadClaims({ ...base, sub: 123 });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad aud type', () => {
    const r = validateBvadClaims({ ...base, aud: 42 });
    expect(!r.ok).toBe(true);
  });

  test('rejects aud array with non-strings', () => {
    const r = validateBvadClaims({ ...base, aud: [1, 2] });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-integer iat', () => {
    const r = validateBvadClaims({ ...base, iat: '2020' });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-integer exp', () => {
    const r = validateBvadClaims({ ...base, exp: 1.5 });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-uuid jti', () => {
    const r = validateBvadClaims({ ...base, jti: 'not-a-uuid' });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-string association', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_ASSOCIATION]: 1 });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-object organisation', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_ORGANISATION]: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects missing organisation fields', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_ORGANISATION]: {} });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-string organisation.vat if present', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_ORGANISATION]: { ...base[BVAD_CLAIM_ORGANISATION], vat: 1 },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-string organisation.lei if present', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_ORGANISATION]: { ...base[BVAD_CLAIM_ORGANISATION], lei: 1 },
    });
    expect(!r.ok).toBe(true);
  });

  test('accepts optional organisation fields', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_ORGANISATION]: {
        ...base[BVAD_CLAIM_ORGANISATION],
        vat: 'NL123',
        lei: 'HWUPKR0MPOU8FGXBT394',
      },
    });
    expect(r.ok).toBe(true);
  });

  test('rejects non-object connector', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_CONNECTOR]: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad connector fields', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_CONNECTOR]: { id: 1, x5t_s256: 2, bound_on: 'now', authorised_by: null },
    });
    expect(!r.ok && r.error.length).toBeGreaterThanOrEqual(4);
  });

  test('rejects non-object assurance', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_ASSURANCE]: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad assurance level', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_ASSURANCE]: { level: 'low', sources: [] },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-array assurance sources', () => {
    const r = validateBvadClaims({
      ...base,
      [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: 'KvK' },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad status', () => {
    const r = validateBvadClaims({ ...base, [BVAD_CLAIM_STATUS]: 'pending' });
    expect(!r.ok).toBe(true);
  });
});
