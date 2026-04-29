// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@transportial/kernel';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  type BvadClaims,
} from '@transportial/contracts';
import { DeterministicUuidGenerator, FakeEventBus } from '@transportial/testing';
import { JwsSigner } from '../../src/infrastructure/crypto/signer.ts';
import {
  TokenExchangeUseCase,
  InMemoryFederationRegistry,
} from '../../src/application/use-cases/token-exchange.ts';
import { compactSign, HmacSigner } from '@transportial/crypto';

function mkPeer() {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return new HmacSigner(key);
}

async function signPeerBvad(
  signer: HmacSigner,
  kid: string,
  claims: BvadClaims,
): Promise<string> {
  return compactSign(claims, signer, { kid, alg: 'ES256' });
}

function bvad(overrides: Partial<BvadClaims> = {}): BvadClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://peer-asr',
    sub: 'urn:bdi:connector:peer',
    aud: 'urn:bdi:association:dtl',
    iat: now - 10,
    exp: now + 600,
    jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
    [BVAD_CLAIM_ASSOCIATION]: 'dtl',
    [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
    [BVAD_CLAIM_CONNECTOR]: {
      id: 'urn:bdi:connector:peer',
      x5t_s256: 'tp',
      bound_on: 0,
      authorised_by: 'rep',
    },
    [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
    [BVAD_CLAIM_STATUS]: 'active',
    ...overrides,
  } as BvadClaims;
}

async function setup() {
  const peerSigner = mkPeer();
  const reg = new InMemoryFederationRegistry();
  reg.add({
    peer_issuer: 'https://peer-asr',
    peer_kid: 'peer-kid',
    peer_signer: peerSigner,
    association_id: 'ctn',
    peer_association_id: 'dtl',
    allow: true,
  });
  const signer = await JwsSigner.generate('ES256');
  const clock = new FakeClock(new Date());
  const bus = new FakeEventBus();
  const ids = new DeterministicUuidGenerator();
  const uc = new TokenExchangeUseCase(reg, signer, clock, { newUuid: () => ids.next() }, bus, {
    issuer: 'https://asr.ctn',
  });
  return { uc, peerSigner, reg, bus };
}

describe('TokenExchangeUseCase', () => {
  test('happy path', async () => {
    const { uc, peerSigner } = await setup();
    const tok = await signPeerBvad(peerSigner, 'peer-kid', bvad());
    const r = await uc.execute({
      subjectToken: tok,
      audience: 'urn:bdi:association:ctn',
    });
    expect(r.ok).toBe(true);
  });

  test('missing subject token', async () => {
    const { uc } = await setup();
    const r = await uc.execute({ subjectToken: '', audience: 'x' });
    expect(!r.ok && r.error.type).toBe('missing-subject-token');
  });

  test('garbage token → unverifiable', async () => {
    const { uc } = await setup();
    const r = await uc.execute({ subjectToken: 'not.a.jwt', audience: 'x' });
    expect(!r.ok && r.error.type).toBe('subject-token-unverifiable');
  });

  test('non-federated peer', async () => {
    const { uc, peerSigner } = await setup();
    const tok = await signPeerBvad(peerSigner, 'peer-kid', bvad({ iss: 'https://mystery' }));
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('peer-not-federated');
  });

  test('disabled peer', async () => {
    const peerSigner = mkPeer();
    const reg = new InMemoryFederationRegistry();
    reg.add({
      peer_issuer: 'https://peer-asr',
      peer_kid: 'peer-kid',
      peer_signer: peerSigner,
      association_id: 'ctn',
      peer_association_id: 'dtl',
      allow: false,
    });
    const signer = await JwsSigner.generate('ES256');
    const bus = new FakeEventBus();
    const uc = new TokenExchangeUseCase(
      reg,
      signer,
      new FakeClock(new Date()),
      { newUuid: () => 'x' },
      bus,
      { issuer: 'https://asr.ctn' },
    );
    const tok = await signPeerBvad(peerSigner, 'peer-kid', bvad());
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('peer-disabled');
  });

  test('expired subject token', async () => {
    const { uc, peerSigner } = await setup();
    const nowUnix = Math.floor(Date.now() / 1000);
    const tok = await signPeerBvad(peerSigner, 'peer-kid', bvad({ iat: nowUnix - 1000, exp: nowUnix - 100 }));
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('subject-token-expired');
  });

  test('wrong peer association', async () => {
    const { uc, peerSigner } = await setup();
    const tok = await signPeerBvad(peerSigner, 'peer-kid', bvad({ [BVAD_CLAIM_ASSOCIATION]: 'different' }));
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('wrong-peer-association');
  });

  test('unverifiable signature (wrong peer kid)', async () => {
    const { uc, peerSigner } = await setup();
    const tok = await signPeerBvad(peerSigner, 'mystery-kid', bvad());
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('subject-token-unverifiable');
  });

  test('claims schema mismatch → unverifiable', async () => {
    const { uc, peerSigner } = await setup();
    const tok = await compactSign({ iss: 'https://peer-asr' }, peerSigner, {
      kid: 'peer-kid',
      alg: 'ES256',
    });
    const r = await uc.execute({ subjectToken: tok, audience: 'x' });
    expect(!r.ok && r.error.type).toBe('subject-token-unverifiable');
  });
});
