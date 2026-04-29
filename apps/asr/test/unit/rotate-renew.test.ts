// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@transportial/kernel';
import { FakeEventBus } from '@transportial/testing';
import { generateKeyPair, publicJwk } from '@transportial/crypto';
import { InMemoryCertificateRepository } from '@transportial/crypto-ca';
import { InMemoryKeystore } from '../../src/application/use-cases/jwks.ts';
import { RotateKeysUseCase } from '../../src/application/use-cases/rotate-keys.ts';
import { RenewCertificatesUseCase } from '../../src/application/use-cases/renew-certificates.ts';

async function freshKeystore() {
  const first = await generateKeyPair('ES256');
  const store = new InMemoryKeystore({
    kid: first.kid,
    alg: 'ES256',
    publicJwk: publicJwk(first.publicJwk),
    status: 'active',
    issuedAt: new Date().toISOString(),
  });
  return { store, first };
}

describe('RotateKeysUseCase', () => {
  test('bootstraps when no next key exists', async () => {
    const { store } = await freshKeystore();
    const bus = new FakeEventBus();
    const uc = new RotateKeysUseCase(store, bus, 'ctn');
    const result = await uc.execute();
    expect(result.newActiveKid).toBeDefined();
    expect(result.newNextKid).toBeDefined();
    expect((await store.all()).filter((r) => r.status === 'next')).toHaveLength(1);
    expect(bus.findAllOfType('asr.keys.rotated')).toHaveLength(1);
  });

  test('promotes next to active and generates fresh next', async () => {
    const { store } = await freshKeystore();
    const second = await generateKeyPair('ES256');
    store.seedNext({
      kid: second.kid,
      alg: 'ES256',
      publicJwk: publicJwk(second.publicJwk),
      status: 'next',
      issuedAt: new Date().toISOString(),
    });
    const bus = new FakeEventBus();
    const uc = new RotateKeysUseCase(store, bus, 'ctn');
    const result = await uc.execute();
    expect(result.newActiveKid).toBe(second.kid);
    const active = await store.active();
    expect(active.kid).toBe(second.kid);
  });
});

describe('RenewCertificatesUseCase', () => {
  test('emits events for certs nearing expiry', async () => {
    const repo = new InMemoryCertificateRepository();
    const clock = new FakeClock();
    const nowMs = clock.nowMillis();
    await repo.save({
      serial: 'near',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: new Date(nowMs + 10 * 86_400_000).toISOString(),
    });
    await repo.save({
      serial: 'far',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: new Date(nowMs + 365 * 86_400_000).toISOString(),
    });
    await repo.save({
      serial: 'revoked',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: new Date(nowMs + 1 * 86_400_000).toISOString(),
      revokedAt: new Date().toISOString(),
    });
    const bus = new FakeEventBus();
    const uc = new RenewCertificatesUseCase(repo, bus, clock, 'ctn', 30 * 86_400);
    const out = await uc.execute();
    expect(out.notified).toBe(1);
    expect(out.skipped).toBe(2);
    expect(bus.findAllOfType('asr.certificate.renewal-due')).toHaveLength(1);
  });

  test('notifies zero when everything is far in the future', async () => {
    const repo = new InMemoryCertificateRepository();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    await repo.save({
      serial: 'far',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: new Date(clock.nowMillis() + 10_000 * 86_400_000).toISOString(),
    });
    const uc = new RenewCertificatesUseCase(repo, bus, clock, 'ctn');
    const out = await uc.execute();
    expect(out.notified).toBe(0);
    expect(out.skipped).toBe(1);
  });

  test('empty repository returns zero', async () => {
    const repo = new InMemoryCertificateRepository();
    const bus = new FakeEventBus();
    const uc = new RenewCertificatesUseCase(repo, bus, new FakeClock(), 'ctn');
    const out = await uc.execute();
    expect(out.notified).toBe(0);
    expect(out.skipped).toBe(0);
  });
});
