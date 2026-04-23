// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@bdi/kernel';
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
import { EmbeddedPdp, type Policy } from '@bdi/policy';
import { VerifyIncomingUseCase } from '../../src/application/use-cases/verify-incoming.ts';

const bvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:association:ctn',
  iat: 1000,
  exp: 1600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
  [BVAD_CLAIM_CONNECTOR]: {
    id: 'urn:bdi:connector:peer',
    x5t_s256: 'tp',
    bound_on: 0,
    authorised_by: 'rep',
  },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

const bvod: BvodClaims = {
  iss: 'https://ors',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:connector:me',
  iat: 1000,
  exp: 2000,
  jti: '1',
  [BVOD_CLAIM_ASSOCIATION]: 'ctn',
  [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'shipment', identifiers: [] },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['carrier'] },
  [BVOD_CLAIM_SCOPE]: ['read:eta'],
};

function permitAll(): EmbeddedPdp {
  return new EmbeddedPdp([{ id: 'all', effect: 'permit', actions: '*' } as Policy]);
}

function deny(): EmbeddedPdp {
  return new EmbeddedPdp([
    { id: 'f', effect: 'forbid', actions: '*', reason: 'nope' } as Policy,
  ]);
}

function mkUseCase(opts: { pdp?: EmbeddedPdp; bvad?: BvadClaims | null; bvod?: BvodClaims | null } = {}) {
  const pdp = opts.pdp ?? permitAll();
  const resolvedBvad = 'bvad' in opts ? opts.bvad : bvad;
  const resolvedBvod = 'bvod' in opts ? opts.bvod : bvod;
  return new VerifyIncomingUseCase(
    { refresh: async () => {}, verifyBvad: async () => resolvedBvad },
    { verifyBvod: async () => resolvedBvod },
    pdp,
    new FakeClock(new Date(1_200_000)),
    {
      asrIssuer: 'https://asr',
      orsIssuer: 'https://ors',
      ownConnectorId: 'urn:bdi:connector:me',
      associationId: 'ctn',
      audience: 'urn:bdi:association:ctn',
    },
  );
}

describe('VerifyIncomingUseCase', () => {
  test('happy path permits', async () => {
    const uc = mkUseCase();
    const r = await uc.execute({
      bvad: 'tok',
      bvod: 'tok',
      action: 'read:shipment',
      resource: { type: 'Shipment', id: '1' },
    });
    expect(r.ok).toBe(true);
  });

  test('missing BVAD', async () => {
    const uc = mkUseCase();
    const r = await uc.execute({
      bvad: null,
      bvod: 'x',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvad-missing');
  });

  test('missing BVOD', async () => {
    const uc = mkUseCase();
    const r = await uc.execute({
      bvad: 'x',
      bvod: null,
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvod-missing');
  });

  test('invalid BVAD signature', async () => {
    const uc = mkUseCase({ bvad: null });
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvad-invalid');
  });

  test('rejected BVAD claim mismatch', async () => {
    const uc = mkUseCase({ bvad: { ...bvad, iss: 'other' } });
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvad-rejected');
  });

  test('invalid BVOD signature', async () => {
    const uc = mkUseCase({ bvod: null });
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvod-invalid');
  });

  test('rejected BVOD claim mismatch', async () => {
    const uc = mkUseCase({ bvod: { ...bvod, iss: 'elsewhere' } });
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('bvod-rejected');
  });

  test('policy deny', async () => {
    const uc = mkUseCase({ pdp: deny() });
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('policy-denied');
  });

  test('passes delegated_from into PDP', async () => {
    let seen: unknown = null;
    const pdp = {
      async decide(input: unknown) {
        seen = input;
        return { effect: 'permit' as const };
      },
    };
    const uc = new VerifyIncomingUseCase(
      { refresh: async () => {}, verifyBvad: async () => bvad },
      {
        verifyBvod: async () => ({
          ...bvod,
          [BVOD_CLAIM_INVOLVEMENT]: {
            ...bvod[BVOD_CLAIM_INVOLVEMENT],
            delegated_from: 'NL.NHR.2',
          },
        }),
      },
      pdp,
      new FakeClock(new Date(1_200_000)),
      {
        asrIssuer: 'https://asr',
        orsIssuer: 'https://ors',
        ownConnectorId: 'urn:bdi:connector:me',
        associationId: 'ctn',
        audience: 'urn:bdi:association:ctn',
      },
    );
    const r = await uc.execute({
      bvad: 'x',
      bvod: 'y',
      action: 'read',
      resource: { type: 'x', id: '1' },
    });
    expect(r.ok).toBe(true);
    expect(
      (seen as { context: { delegated_by?: string } }).context.delegated_by,
    ).toBe('NL.NHR.2');
  });
});
