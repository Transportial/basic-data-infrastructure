// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { JwsSigner, randomSigningKey } from '../../src/infrastructure/crypto/signer.ts';

describe('JwsSigner', () => {
  test('signJwt produces a three-segment compact JWS (HMAC)', async () => {
    const s = JwsSigner.fromHmac('k1', randomSigningKey(), 'EdDSA');
    const token = await s.signJwt({ iss: 'asr', sub: 'c' });
    expect(token.split('.')).toHaveLength(3);
  });

  test('verifyJwt reads back claims (HMAC)', async () => {
    const s = JwsSigner.fromHmac('k2', randomSigningKey());
    const token = await s.signJwt({ iss: 'asr', sub: 'c' });
    const claims = (await s.verifyJwt(token)) as { iss: string };
    expect(claims.iss).toBe('asr');
  });

  test('verifyJwt throws on tampered token', async () => {
    const s = JwsSigner.fromHmac('k3', randomSigningKey());
    const token = await s.signJwt({ n: 1 });
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.AAAA`;
    await expect(s.verifyJwt(tampered)).rejects.toThrow();
  });

  test('kid is exposed', () => {
    const s = JwsSigner.fromHmac('special-kid', new Uint8Array(32));
    expect(s.kid).toBe('special-kid');
  });

  test('trustlist() contains the signer', () => {
    const s = JwsSigner.fromHmac('k4', new Uint8Array(32));
    expect(s.trustlist().size()).toBe(1);
  });

  test('default alg is ES256', async () => {
    const s = JwsSigner.fromHmac('k5', new Uint8Array(32));
    const token = await s.signJwt({});
    const [h] = token.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString('utf-8'));
    expect(header.alg).toBe('ES256');
  });

  test('JwsSigner.generate() produces a real ES256 key and exposes public JWK', async () => {
    const s = await JwsSigner.generate('ES256');
    const token = await s.signJwt({ test: true });
    const claims = (await s.verifyJwt(token)) as { test: boolean };
    expect(claims.test).toBe(true);
    expect(s.publicJwk.kty).toBe('EC');
  });

  test('JwsSigner.generate EdDSA', async () => {
    const s = await JwsSigner.generate('EdDSA');
    const token = await s.signJwt({});
    expect(token.split('.')).toHaveLength(3);
  });

  test('JwsSigner.generate ES384', async () => {
    const s = await JwsSigner.generate('ES384');
    const token = await s.signJwt({});
    expect(token.split('.')).toHaveLength(3);
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
