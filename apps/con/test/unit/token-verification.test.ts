// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  type BvadClaims,
  type BvodClaims,
} from '@bdi/contracts';
import {
  validateBvadTiming,
  validateBvodTiming,
  DEFAULT_SKEW,
} from '../../src/domain/token-verification.ts';

const baseBvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:a',
  aud: 'aud',
  iat: 1_000,
  exp: 1_600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.12345678', legal_name: 'Acme BV' },
  [BVAD_CLAIM_CONNECTOR]: {
    id: 'urn:bdi:connector:a',
    x5t_s256: 'tp',
    bound_on: 0,
    authorised_by: 'rep',
  },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

describe('validateBvadTiming', () => {
  test('accepts within window', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 1_200,
      expectedIssuer: 'https://asr',
      expectedAudience: 'aud',
      expectedAssociation: 'ctn',
    });
    expect(r.ok).toBe(true);
  });

  test('rejects expired', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 9_999,
      expectedIssuer: 'https://asr',
      expectedAudience: 'aud',
      expectedAssociation: 'ctn',
    });
    expect(!r.ok && r.error.type).toBe('expired');
  });

  test('rejects not-yet-valid', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 500,
      expectedIssuer: 'https://asr',
      expectedAudience: 'aud',
      expectedAssociation: 'ctn',
    });
    expect(!r.ok && r.error.type).toBe('not-yet-valid');
  });

  test('rejects wrong issuer', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 1_200,
      expectedIssuer: 'https://other',
      expectedAudience: 'aud',
      expectedAssociation: 'ctn',
    });
    expect(!r.ok && r.error.type).toBe('wrong-issuer');
  });

  test('rejects wrong audience (string)', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 1_200,
      expectedIssuer: 'https://asr',
      expectedAudience: 'other',
      expectedAssociation: 'ctn',
    });
    expect(!r.ok && r.error.type).toBe('wrong-audience');
  });

  test('audience array matched', () => {
    const r = validateBvadTiming(
      { ...baseBvad, aud: ['other', 'aud'] },
      {
        now: 1_200,
        expectedIssuer: 'https://asr',
        expectedAudience: 'aud',
        expectedAssociation: 'ctn',
      },
    );
    expect(r.ok).toBe(true);
  });

  test('audience array mismatch rejected', () => {
    const r = validateBvadTiming(
      { ...baseBvad, aud: ['a', 'b'] },
      {
        now: 1_200,
        expectedIssuer: 'https://asr',
        expectedAudience: 'c',
        expectedAssociation: 'ctn',
      },
    );
    expect(!r.ok).toBe(true);
  });

  test('rejects suspended status', () => {
    const r = validateBvadTiming(
      { ...baseBvad, [BVAD_CLAIM_STATUS]: 'suspended' },
      {
        now: 1_200,
        expectedIssuer: 'https://asr',
        expectedAudience: 'aud',
        expectedAssociation: 'ctn',
      },
    );
    expect(!r.ok && r.error.type).toBe('wrong-status');
  });

  test('rejects wrong association', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 1_200,
      expectedIssuer: 'https://asr',
      expectedAudience: 'aud',
      expectedAssociation: 'other',
    });
    expect(!r.ok && r.error.type).toBe('wrong-association');
  });

  test('honours custom skew', () => {
    const r = validateBvadTiming(baseBvad, {
      now: 1_600 + 10,
      expectedIssuer: 'https://asr',
      expectedAudience: 'aud',
      expectedAssociation: 'ctn',
      skew: { seconds: 5 },
    });
    expect(!r.ok).toBe(true);
  });

  test('DEFAULT_SKEW constant', () => {
    expect(DEFAULT_SKEW.seconds).toBe(30);
  });
});

const baseBvod: BvodClaims = {
  iss: 'https://ors',
  sub: 'urn:bdi:connector:a',
  aud: 'urn:bdi:connector:me',
  iat: 1_000,
  exp: 2_000,
  jti: '1',
  [BVOD_CLAIM_ASSOCIATION]: 'ctn',
  [BVOD_CLAIM_CHAIN_CONTEXT]: {
    id: 'cctx',
    kind: 'shipment',
    identifiers: [],
  },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['carrier'] },
  [BVOD_CLAIM_SCOPE]: ['read:eta'],
};

describe('validateBvodTiming', () => {
  test('accepts valid', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 1_500,
      expectedIssuer: 'https://ors',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:a',
    });
    expect(r.ok).toBe(true);
  });

  test('expired', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 9_999,
      expectedIssuer: 'https://ors',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:a',
    });
    expect(!r.ok && r.error.type).toBe('expired');
  });

  test('not yet valid', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 0,
      expectedIssuer: 'https://ors',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:a',
    });
    expect(!r.ok && r.error.type).toBe('not-yet-valid');
  });

  test('wrong issuer', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 1_500,
      expectedIssuer: 'other',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:a',
    });
    expect(!r.ok && r.error.type).toBe('wrong-issuer');
  });

  test('wrong audience', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 1_500,
      expectedIssuer: 'https://ors',
      expectedAudience: 'other',
      subjectConnectorId: 'urn:bdi:connector:a',
    });
    expect(!r.ok && r.error.type).toBe('wrong-audience');
  });

  test('connector mismatch', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 1_500,
      expectedIssuer: 'https://ors',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:b',
    });
    expect(!r.ok && r.error.type).toBe('connector-mismatch');
  });

  test('custom skew', () => {
    const r = validateBvodTiming(baseBvod, {
      now: 2_020,
      expectedIssuer: 'https://ors',
      expectedAudience: 'urn:bdi:connector:me',
      subjectConnectorId: 'urn:bdi:connector:a',
      skew: { seconds: 5 },
    });
    expect(!r.ok).toBe(true);
  });
});
