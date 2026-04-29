// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  InMemoryAccountRepository,
  InMemoryAuthorizationRepository,
  InMemoryCertificateRepository,
  InMemoryEabStore,
  InMemoryNonceStore,
  InMemoryOrderRepository,
} from '../src/acme/repositories.ts';
import type { AcmeAccount, AcmeOrder, Authorization, IssuedCertificate } from '../src/acme/types.ts';
import { generateKeyPair, publicJwk } from '@transportial/crypto';

describe('InMemoryAccountRepository', () => {
  test('save + find by id and thumbprint', async () => {
    const kp = await generateKeyPair('ES256');
    const repo = new InMemoryAccountRepository();
    const a: AcmeAccount = {
      id: 'a',
      status: 'valid',
      contact: [],
      termsOfServiceAgreed: true,
      orders: 'x',
      createdAt: 'now',
      publicJwk: publicJwk(kp.publicJwk),
      externalAccountKid: 'eab',
    };
    await repo.save(a);
    expect((await repo.find('a'))?.id).toBe('a');
    expect(await repo.find('missing')).toBeNull();
    const tpFound = await repo.findByJwkThumbprint(kp.kid);
    expect(tpFound?.id).toBe('a');
    expect(await repo.findByJwkThumbprint('other')).toBeNull();
  });
});

describe('InMemoryOrderRepository', () => {
  test('save + find + listByAccount', async () => {
    const repo = new InMemoryOrderRepository();
    const o: AcmeOrder = {
      id: 'o',
      accountId: 'a',
      status: 'pending',
      expires: 'x',
      identifiers: [],
      authorizationIds: [],
      finalizeUrl: 'u',
    };
    await repo.save(o);
    expect((await repo.find('o'))?.id).toBe('o');
    expect(await repo.find('missing')).toBeNull();
    expect(await repo.listByAccount('a')).toHaveLength(1);
    expect(await repo.listByAccount('other')).toHaveLength(0);
  });
});

describe('InMemoryAuthorizationRepository', () => {
  test('save + find', async () => {
    const repo = new InMemoryAuthorizationRepository();
    const a: Authorization = {
      id: 'auth',
      accountId: 'a',
      orderId: 'o',
      identifier: { type: 'dns', value: 'example.com' },
      status: 'pending',
      expires: 'x',
      challenges: [],
      wildcard: false,
    };
    await repo.save(a);
    expect((await repo.find('auth'))?.id).toBe('auth');
    expect(await repo.find('x')).toBeNull();
  });
});

describe('InMemoryCertificateRepository', () => {
  test('save + find + list revoked', async () => {
    const repo = new InMemoryCertificateRepository();
    const c1: IssuedCertificate = {
      serial: '1',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: 'x',
    };
    const c2: IssuedCertificate = {
      ...c1,
      serial: '2',
      revokedAt: 'now',
      revocationReason: 'keyCompromise',
    };
    await repo.save(c1);
    await repo.save(c2);
    expect((await repo.find('1'))?.serial).toBe('1');
    expect(await repo.find('3')).toBeNull();
    expect((await repo.listRevoked()).map((c) => c.serial)).toEqual(['2']);
  });
});

describe('InMemoryNonceStore', () => {
  test('issue + consume single use', async () => {
    const s = new InMemoryNonceStore();
    const nonce = await s.issue();
    expect(await s.consume(nonce)).toBe(true);
    expect(await s.consume(nonce)).toBe(false);
  });

  test('consume unknown', async () => {
    const s = new InMemoryNonceStore();
    expect(await s.consume('unknown')).toBe(false);
  });

  test('pending returns outstanding nonces', async () => {
    const s = new InMemoryNonceStore();
    await s.issue();
    await s.issue();
    const pend = await s.pending();
    expect(pend.length).toBe(2);
  });

  test('ttl expiration prunes old nonces', async () => {
    const s = new InMemoryNonceStore(1); // 1ms ttl
    const nonce = await s.issue();
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.consume(nonce)).toBe(false);
  });
});

describe('InMemoryEabStore', () => {
  test('register + find + markUsed', async () => {
    const s = new InMemoryEabStore();
    s.register({
      kid: 'k',
      hmacKey: new Uint8Array(16),
      clientId: 'c',
    });
    expect((await s.find('k'))?.clientId).toBe('c');
    expect(await s.find('other')).toBeNull();
    await s.markUsed('k', 'now');
    expect((await s.find('k'))?.usedAt).toBe('now');
    await s.markUsed('missing', 'now'); // no-op
  });
});
