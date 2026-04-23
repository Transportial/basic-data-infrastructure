// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { JwsSigner, randomSigningKey } from '../../src/infrastructure/crypto/signer.ts';

describe('JwsSigner', () => {
  test('signJwt produces a three-segment compact JWS', async () => {
    const s = new JwsSigner({ kid: 'k1', key: randomSigningKey(), alg: 'EdDSA' });
    const token = await s.signJwt({ iss: 'asr', sub: 'c' });
    expect(token.split('.')).toHaveLength(3);
  });

  test('verifyJwt reads back claims', async () => {
    const s = new JwsSigner({ kid: 'k2', key: randomSigningKey() });
    const token = await s.signJwt({ iss: 'asr', sub: 'c' });
    const claims = (await s.verifyJwt(token)) as { iss: string };
    expect(claims.iss).toBe('asr');
  });

  test('verifyJwt throws on tampered token', async () => {
    const s = new JwsSigner({ kid: 'k3', key: randomSigningKey() });
    const token = await s.signJwt({ n: 1 });
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.AAAA`;
    await expect(s.verifyJwt(tampered)).rejects.toThrow();
  });

  test('kid is exposed', () => {
    const s = new JwsSigner({ kid: 'special-kid', key: new Uint8Array(32) });
    expect(s.kid).toBe('special-kid');
  });

  test('trustlist() contains the signer', () => {
    const s = new JwsSigner({ kid: 'k4', key: new Uint8Array(32) });
    expect(s.trustlist().size()).toBe(1);
  });

  test('default alg is ES256', async () => {
    const s = new JwsSigner({ kid: 'k5', key: new Uint8Array(32) });
    const token = await s.signJwt({});
    const [h] = token.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString('utf-8'));
    expect(header.alg).toBe('ES256');
  });
});

describe('randomSigningKey', () => {
  test('produces 32-byte key', () => {
    const k = randomSigningKey();
    expect(k.length).toBe(32);
  });

  test('distinct calls differ', () => {
    const a = randomSigningKey();
    const b = randomSigningKey();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
