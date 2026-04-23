// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
import { describe, test, expect } from 'bun:test';
import {
  validateBvodClaims,
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  BVOD_LIFETIME_SECONDS,
} from '../src/tokens/bvod.ts';

const base = {
  iss: 'https://ors.ctn.bdi.nl',
  sub: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
  aud: 'urn:bdi:connector:target',
  iat: 1_700_000_000,
  exp: 1_700_003_600,
  jti: 'jti-1',
  [BVOD_CLAIM_ASSOCIATION]: 'ctn',
  [BVOD_CLAIM_CHAIN_CONTEXT]: {
    id: '9f3a2c10-1234-4abc-89ab-cdef01234567',
    kind: 'shipment',
    identifiers: [{ scheme: 'bl', value: 'MSCU123' }],
  },
  [BVOD_CLAIM_INVOLVEMENT]: {
    member_euid: 'NL.NHR.12345678',
    roles: ['carrier'],
  },
  [BVOD_CLAIM_SCOPE]: ['read:eta'],
};

describe('validateBvodClaims', () => {
  test('lifetime is 60 minutes', () => {
    expect(BVOD_LIFETIME_SECONDS).toBe(3600);
  });

  test('accepts valid claims', () => {
    const r = validateBvodClaims(base);
    expect(r.ok).toBe(true);
  });

  test('accepts optional delegated_from', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_INVOLVEMENT]: { ...base[BVOD_CLAIM_INVOLVEMENT], delegated_from: 'NL.NHR.0' },
    });
    expect(r.ok).toBe(true);
  });

  test('rejects non-object', () => {
    expect(validateBvodClaims(null).ok).toBe(false);
  });

  test('rejects bad top-level primitives', () => {
    const r = validateBvodClaims({
      ...base,
      iss: 1,
      sub: 1,
      aud: 1,
      iat: 'x',
      exp: 'x',
      jti: 1,
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-object chain context', () => {
    const r = validateBvodClaims({ ...base, [BVOD_CLAIM_CHAIN_CONTEXT]: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad chain context kind', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_CHAIN_CONTEXT]: { ...base[BVOD_CLAIM_CHAIN_CONTEXT], kind: 'unknown' },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-array identifiers', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_CHAIN_CONTEXT]: { ...base[BVOD_CLAIM_CHAIN_CONTEXT], identifiers: 'x' },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects malformed identifier entries', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_CHAIN_CONTEXT]: {
        ...base[BVOD_CLAIM_CHAIN_CONTEXT],
        identifiers: [{ scheme: 1, value: 2 }, 'oops'],
      },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-object involvement', () => {
    const r = validateBvodClaims({ ...base, [BVOD_CLAIM_INVOLVEMENT]: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad involvement roles type', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'x', roles: 'carrier' },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-string delegated_from if present', () => {
    const r = validateBvodClaims({
      ...base,
      [BVOD_CLAIM_INVOLVEMENT]: { ...base[BVOD_CLAIM_INVOLVEMENT], delegated_from: 42 },
    });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad scope', () => {
    const r = validateBvodClaims({ ...base, [BVOD_CLAIM_SCOPE]: 'read:eta' });
    expect(!r.ok).toBe(true);
  });
});
