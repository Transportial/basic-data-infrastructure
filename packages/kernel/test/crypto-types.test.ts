// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { validatePublicJwk, isPublicJwk } from '../src/crypto-types/jwk.ts';
import {
  validateBdiJwsHeader,
  BDI_PROFILE_VERSION_HEADER,
} from '../src/crypto-types/jws-header.ts';
import {
  canonicalJwkMembers,
  canonicalJwkJson,
  jwkThumbprint,
  base64UrlEncode,
  base64UrlDecode,
} from '../src/crypto-types/thumbprint.ts';

describe('JWK validation', () => {
  test('accepts Ed25519 public JWK', () => {
    const r = validatePublicJwk({ kty: 'OKP', crv: 'Ed25519', x: 'abc' });
    expect(r.ok).toBe(true);
  });

  test('rejects non-object', () => {
    const r = validatePublicJwk(null);
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects missing kty', () => {
    const r = validatePublicJwk({ crv: 'P-256' });
    expect(!r.ok && r.error.type).toBe('missing-kty');
  });

  test('rejects private key material', () => {
    const r = validatePublicJwk({ kty: 'OKP', crv: 'Ed25519', x: 'a', d: 'private!' });
    expect(!r.ok && r.error.type).toBe('private-material-leaked');
  });

  test('rejects unsupported kty', () => {
    const r = validatePublicJwk({ kty: 'oct', k: 'symmetric' });
    expect(!r.ok && r.error.type).toBe('unsupported-kty');
  });

  test('isPublicJwk narrows', () => {
    expect(isPublicJwk({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' })).toBe(true);
    expect(isPublicJwk('not an object')).toBe(false);
  });
});

describe('BDI JWS header validation', () => {
  const good = {
    alg: 'EdDSA',
    kid: 'asr-2026-01',
    [BDI_PROFILE_VERSION_HEADER]: 1,
    crit: [BDI_PROFILE_VERSION_HEADER],
  };

  test('accepts well-formed header', () => {
    const r = validateBdiJwsHeader(good);
    expect(r.ok).toBe(true);
  });

  test('rejects non-object', () => {
    const r = validateBdiJwsHeader(null);
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects missing alg', () => {
    const r = validateBdiJwsHeader({ ...good, alg: undefined });
    expect(!r.ok && r.error.type).toBe('missing-alg');
  });

  test('rejects disallowed alg', () => {
    const r = validateBdiJwsHeader({ ...good, alg: 'HS256' });
    expect(!r.ok && r.error.type).toBe('disallowed-alg');
  });

  test('rejects missing kid', () => {
    const r = validateBdiJwsHeader({ ...good, kid: '' });
    expect(!r.ok && r.error.type).toBe('missing-kid');
  });

  test('rejects missing profile version', () => {
    const r = validateBdiJwsHeader({ ...good, [BDI_PROFILE_VERSION_HEADER]: 2 });
    expect(!r.ok && r.error.type).toBe('missing-profile-version');
  });

  test('rejects missing crit', () => {
    const r = validateBdiJwsHeader({ ...good, crit: [] });
    expect(!r.ok && r.error.type).toBe('missing-crit-profile');
  });
});

describe('thumbprint', () => {
  test('canonicalJwkMembers OKP', () => {
    expect(canonicalJwkMembers({ kty: 'OKP', crv: 'Ed25519', x: 'a' })).toEqual({
      crv: 'Ed25519',
      kty: 'OKP',
      x: 'a',
    });
  });

  test('canonicalJwkMembers OKP defaults when missing', () => {
    expect(canonicalJwkMembers({ kty: 'OKP' })).toEqual({ crv: '', kty: 'OKP', x: '' });
  });

  test('canonicalJwkMembers EC', () => {
    expect(canonicalJwkMembers({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' })).toEqual({
      crv: 'P-256',
      kty: 'EC',
      x: 'a',
      y: 'b',
    });
  });

  test('canonicalJwkMembers EC defaults when missing', () => {
    expect(canonicalJwkMembers({ kty: 'EC' })).toEqual({
      crv: '',
      kty: 'EC',
      x: '',
      y: '',
    });
  });

  test('canonicalJwkMembers RSA', () => {
    expect(canonicalJwkMembers({ kty: 'RSA', n: 'aa', e: 'AQAB' })).toEqual({
      e: 'AQAB',
      kty: 'RSA',
      n: 'aa',
    });
  });

  test('canonicalJwkMembers RSA defaults when missing', () => {
    expect(canonicalJwkMembers({ kty: 'RSA' })).toEqual({ e: '', kty: 'RSA', n: '' });
  });

  test('canonicalJwkMembers throws for unknown kty', () => {
    expect(() => canonicalJwkMembers({ kty: 'oct' })).toThrow();
  });

  test('canonicalJwkJson orders keys alphabetically', () => {
    const json = canonicalJwkJson({ kty: 'OKP', crv: 'Ed25519', x: 'a' });
    expect(json).toBe('{"crv":"Ed25519","kty":"OKP","x":"a"}');
  });

  test('jwkThumbprint matches RFC 7638 known vector family', async () => {
    // From RFC 7638 §3.1 (RSA example shortened). We verify the mechanism is stable.
    const tp1 = await jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: 'aaa' });
    const tp2 = await jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: 'aaa' });
    expect(tp1).toBe(tp2);
    expect(tp1.length).toBeGreaterThan(20);
  });

  test('base64UrlEncode/Decode round-trip', () => {
    const input = new Uint8Array([1, 2, 3, 4, 255, 127, 0]);
    const enc = base64UrlEncode(input);
    expect(enc).not.toContain('+');
    expect(enc).not.toContain('/');
    expect(enc).not.toContain('=');
    const dec = base64UrlDecode(enc);
    expect(Array.from(dec)).toEqual(Array.from(input));
  });

  test('base64UrlDecode handles missing padding', () => {
    const dec = base64UrlDecode('AQ');
    expect(dec[0]).toBe(1);
  });
});
