// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { generateKeyPair, publicJwk } from '@transportial/crypto';
import {
  InMemoryKeystore,
  InMemoryJwksService,
} from '../../src/application/use-cases/jwks.ts';
import {
  InMemoryTokensJournal,
  hashClaims,
} from '../../src/application/use-cases/issued-tokens-journal.ts';
import {
  AuthenticateClientUseCase,
  InMemoryJtiCache,
} from '../../src/application/use-cases/authenticate-client.ts';
import { InMemoryConnectorRepository, InMemoryMemberRepository } from '../../src/infrastructure/repositories/in-memory.ts';
import type { Connector } from '../../src/domain/model/connector.ts';
import { FakeClock } from '@transportial/kernel';

async function freshKeystore() {
  const kp = await generateKeyPair('ES256');
  const keystore = new InMemoryKeystore({
    kid: kp.kid,
    alg: 'ES256',
    publicJwk: publicJwk(kp.publicJwk),
    status: 'active',
    issuedAt: new Date().toISOString(),
  });
  return { keystore, kp };
}

describe('InMemoryKeystore', () => {
  test('active returns the seeded key', async () => {
    const { keystore, kp } = await freshKeystore();
    expect((await keystore.active()).kid).toBe(kp.kid);
  });

  test('throws when no active key', async () => {
    const keystore = new InMemoryKeystore({
      kid: 'k',
      alg: 'ES256',
      publicJwk: {} as never,
      status: 'retired',
      issuedAt: '',
    });
    await expect(keystore.active()).rejects.toThrow();
  });

  test('next initially null', async () => {
    const { keystore } = await freshKeystore();
    expect(await keystore.next()).toBeNull();
  });

  test('seedNext + next returns the next key', async () => {
    const { keystore } = await freshKeystore();
    const kp2 = await generateKeyPair('ES256');
    keystore.seedNext({
      kid: kp2.kid,
      alg: 'ES256',
      publicJwk: publicJwk(kp2.publicJwk),
      status: 'next',
      issuedAt: '',
    });
    expect((await keystore.next())?.kid).toBe(kp2.kid);
  });

  test('promoteNextToActive rotates status', async () => {
    const { keystore } = await freshKeystore();
    const next = await generateKeyPair('ES256');
    keystore.seedNext({
      kid: next.kid,
      alg: 'ES256',
      publicJwk: publicJwk(next.publicJwk),
      status: 'next',
      issuedAt: '',
    });
    const newNext = await generateKeyPair('ES256');
    await keystore.promoteNextToActive({
      kid: newNext.kid,
      alg: 'ES256',
      publicJwk: publicJwk(newNext.publicJwk),
      status: 'next',
      issuedAt: '',
    });
    expect((await keystore.active()).kid).toBe(next.kid);
    expect((await keystore.next())?.kid).toBe(newNext.kid);
    const all = await keystore.all();
    expect(all.filter((r) => r.status === 'retired')).toHaveLength(1);
  });
});

describe('InMemoryJwksService', () => {
  test('returns active + next only', async () => {
    const { keystore } = await freshKeystore();
    const next = await generateKeyPair('ES256');
    keystore.seedNext({
      kid: next.kid,
      alg: 'ES256',
      publicJwk: publicJwk(next.publicJwk),
      status: 'next',
      issuedAt: '',
    });
    const svc = new InMemoryJwksService(keystore);
    const keys = await svc.current();
    expect(keys).toHaveLength(2);
  });
});

describe('hashClaims', () => {
  test('stable hash regardless of key order', async () => {
    const a = await hashClaims({ b: 2, a: 1 });
    const b = await hashClaims({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  test('different payloads differ', async () => {
    const a = await hashClaims({ a: 1 });
    const b = await hashClaims({ a: 2 });
    expect(a).not.toBe(b);
  });

  test('handles arrays and nested objects', async () => {
    const h = await hashClaims({ xs: [1, 2, { y: 'z' }] });
    expect(h.length).toBe(64);
  });
});

describe('InMemoryTokensJournal', () => {
  test('record + find + revoke + list', async () => {
    const j = new InMemoryTokensJournal();
    await j.record({
      jti: 'a',
      token_type: 'bvad',
      issued_to: 'client-1',
      issued_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-01T00:10:00Z',
      claims_hash: 'hash',
    });
    const found = await j.find('a');
    expect(found?.jti).toBe('a');
    expect(found?.revoked_at).toBeNull();
    await j.revoke('a', '2026-01-01T00:05:00Z');
    const r2 = await j.find('a');
    expect(r2?.revoked_at).toBe('2026-01-01T00:05:00Z');
    const list = await j.list('2026-01-01T00:00:00Z');
    expect(list).toHaveLength(1);
    const empty = await j.list('2030-01-01T00:00:00Z');
    expect(empty).toHaveLength(0);
  });

  test('find unknown returns null', async () => {
    const j = new InMemoryTokensJournal();
    expect(await j.find('x')).toBeNull();
  });

  test('revoke unknown is no-op', async () => {
    const j = new InMemoryTokensJournal();
    await j.revoke('missing', 'now');
    expect(await j.find('missing')).toBeNull();
  });
});

describe('InMemoryJtiCache', () => {
  test('remember + seen', async () => {
    const c = new InMemoryJtiCache();
    expect(await c.seen('a')).toBe(false);
    await c.remember('a', 100);
    expect(await c.seen('a')).toBe(true);
  });

  test('expired entry is purged', async () => {
    const c = new InMemoryJtiCache();
    await c.remember('a', -10);
    expect(await c.seen('a')).toBe(false);
  });
});

describe('AuthenticateClientUseCase', () => {
  test('unknown client', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const uc = new AuthenticateClientUseCase(connectors, new FakeClock(), new InMemoryJtiCache());
    const r = await uc.execute({ clientId: 'x', clientAssertion: 'a.b.c', expectedAudience: 'aud' });
    expect(!r.ok && r.error.type).toBe('unknown-client');
  });

  test('non-active connector', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const kp = await generateKeyPair('ES256');
    const con: Connector = {
      id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
      member_id: 'm',
      client_id: 'c',
      kid: kp.kid,
      jwk: publicJwk(kp.publicJwk) as unknown as Record<string, unknown>,
      cert_thumbprint: 'tp',
      cert_not_after: 9_999_999_999,
      callback_urls: [],
      status: 'suspended',
      bound_on: 0,
      authorised_by: 'rep',
      created_at: 'now',
    } as Connector;
    await connectors.save(con);
    const uc = new AuthenticateClientUseCase(connectors, new FakeClock(), new InMemoryJtiCache());
    const r = await uc.execute({ clientId: 'c', clientAssertion: 'a.b.c', expectedAudience: 'aud' });
    expect(!r.ok && r.error.type).toBe('connector-not-active');
  });

  test('invalid assertion', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const kp = await generateKeyPair('ES256');
    const con: Connector = {
      id: 'urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567',
      member_id: 'm',
      client_id: 'c',
      kid: kp.kid,
      jwk: publicJwk(kp.publicJwk) as unknown as Record<string, unknown>,
      cert_thumbprint: 'tp',
      cert_not_after: 9_999_999_999,
      callback_urls: [],
      status: 'active',
      bound_on: 0,
      authorised_by: 'rep',
      created_at: 'now',
    } as Connector;
    await connectors.save(con);
    const uc = new AuthenticateClientUseCase(connectors, new FakeClock(), new InMemoryJtiCache());
    const r = await uc.execute({
      clientId: 'c',
      clientAssertion: 'not.a.valid',
      expectedAudience: 'aud',
    });
    expect(!r.ok && r.error.type).toBe('assertion-invalid');
  });
});
