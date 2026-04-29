// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { BDI_PROFILE_VERSION_HEADER, base64UrlEncode } from '@bdi/kernel';
import { compactSign, compactVerify, type RawSigner } from '../src/jws.ts';
import { HmacSigner } from '../src/hmac-signer.ts';
import { InMemoryTrustlist } from '../src/trustlist.ts';

function makeSigner(): HmacSigner {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return new HmacSigner(key);
}

describe('compactSign / compactVerify', () => {
  test('round-trips payload', async () => {
    const signer = makeSigner();
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer });

    const token = await compactSign({ hello: 'world' }, signer, {
      kid: 'k1',
      alg: 'EdDSA',
      typ: 'bvad+jwt',
    });
    const verified = await compactVerify<{ hello: string }>(token, list);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.payload.hello).toBe('world');
      expect(verified.value.header.kid).toBe('k1');
      expect(verified.value.header[BDI_PROFILE_VERSION_HEADER]).toBe(1);
      expect(verified.value.header.crit).toContain(BDI_PROFILE_VERSION_HEADER);
    }
  });

  test('includes optional x5t and x5c when provided', async () => {
    const signer = makeSigner();
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer, thumbprint: 'tp' });

    const token = await compactSign({ k: 1 }, signer, {
      kid: 'k1',
      alg: 'ES256',
      'x5t#S256': 'tp',
      x5c: ['cert-pem'],
    });
    const verified = await compactVerify(token, list);
    if (verified.ok) {
      expect(verified.value.header['x5t#S256']).toBe('tp');
      expect(verified.value.header.x5c).toEqual(['cert-pem']);
    }
  });

  test('rejects malformed compact (wrong segment count)', async () => {
    const list = new InMemoryTrustlist();
    const r = await compactVerify('a.b', list);
    expect(!r.ok && r.error.type).toBe('malformed');
  });

  test('rejects malformed header (invalid JSON)', async () => {
    const list = new InMemoryTrustlist();
    const r = await compactVerify('AA.BB.CC', list);
    expect(!r.ok && r.error.type).toBe('malformed');
  });

  test('rejects invalid BDI header', async () => {
    const list = new InMemoryTrustlist();
    const badHeader = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify({ alg: 'HS256', kid: 'k' })),
    );
    const compact = `${badHeader}.${base64UrlEncode(new TextEncoder().encode('{}'))}.aa`;
    const r = await compactVerify(compact, list);
    expect(!r.ok && r.error.type).toBe('invalid-header');
  });

  test('rejects unknown kid', async () => {
    const signer = makeSigner();
    const list = new InMemoryTrustlist();
    const token = await compactSign({}, signer, { kid: 'mystery', alg: 'EdDSA' });
    const r = await compactVerify(token, list);
    expect(!r.ok && r.error.type).toBe('unknown-signer');
  });

  test('rejects thumbprint mismatch', async () => {
    const signer = makeSigner();
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer, thumbprint: 'correct' });
    const token = await compactSign({}, signer, {
      kid: 'k1',
      alg: 'EdDSA',
      'x5t#S256': 'wrong',
    });
    const r = await compactVerify(token, list);
    expect(!r.ok && r.error.type).toBe('unknown-signer');
  });

  test('rejects bad signature (wrong signer)', async () => {
    const signerA = makeSigner();
    const signerB = makeSigner();
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer: signerB });

    const token = await compactSign({}, signerA, { kid: 'k1', alg: 'EdDSA' });
    const r = await compactVerify(token, list);
    expect(!r.ok && r.error.type).toBe('bad-signature');
  });

  test('rejects invalid payload JSON', async () => {
    const signer = makeSigner();
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer });

    const headerB64 = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          alg: 'EdDSA',
          kid: 'k1',
          [BDI_PROFILE_VERSION_HEADER]: 1,
          crit: [BDI_PROFILE_VERSION_HEADER],
        }),
      ),
    );
    const payloadB64 = base64UrlEncode(new TextEncoder().encode('not-json'));
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = await signer.sign(signingInput);
    const compact = `${headerB64}.${payloadB64}.${base64UrlEncode(sig)}`;

    const r = await compactVerify(compact, list);
    expect(!r.ok && r.error.type).toBe('invalid-payload');
  });
});

describe('HmacSigner', () => {
  test('sign and verify round-trip', async () => {
    const key = new TextEncoder().encode('secret-enough-for-hmac-sha256-test');
    const s = new HmacSigner(key);
    const msg = new TextEncoder().encode('hello');
    const sig = await s.sign(msg);
    expect(await s.verify(msg, sig)).toBe(true);
    const altered = new TextEncoder().encode('hellO');
    expect(await s.verify(altered, sig)).toBe(false);
  });
});

describe('InMemoryTrustlist', () => {
  const signer: RawSigner = { sign: async () => new Uint8Array(), verify: async () => true };

  test('add/remove/resolve', async () => {
    const t = new InMemoryTrustlist();
    t.add({ kid: 'k1', signer });
    expect(t.size()).toBe(1);
    expect(await t.resolve('k1')).toBe(signer);
    t.remove('k1');
    expect(await t.resolve('k1')).toBeNull();
  });

  test('resolve ignores missing thumbprint on entry', async () => {
    const t = new InMemoryTrustlist();
    t.add({ kid: 'k1', signer });
    expect(await t.resolve('k1', 'some-thumbprint')).toBe(signer);
  });

  test('resolve returns null for thumbprint mismatch', async () => {
    const t = new InMemoryTrustlist();
    t.add({ kid: 'k1', signer, thumbprint: 'A' });
    expect(await t.resolve('k1', 'B')).toBeNull();
  });

  test('snapshot', () => {
    const t = new InMemoryTrustlist();
    t.add({ kid: 'k1', signer, thumbprint: 'tp' });
    t.add({ kid: 'k2', signer });
    const snap = t.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.find((e) => e.kid === 'k1')?.thumbprint).toBe('tp');
    expect(snap.find((e) => e.kid === 'k2')?.thumbprint).toBeUndefined();
  });
});
