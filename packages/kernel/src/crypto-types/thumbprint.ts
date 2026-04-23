// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Jwk } from './jwk.ts';

// Returns the canonical members used for RFC 7638 thumbprint calculation per JWK type.
export function canonicalJwkMembers(jwk: Jwk): Record<string, string> {
  switch (jwk.kty) {
    case 'OKP':
      return { crv: jwk.crv ?? '', kty: 'OKP', x: jwk.x ?? '' };
    case 'EC':
      return { crv: jwk.crv ?? '', kty: 'EC', x: jwk.x ?? '', y: jwk.y ?? '' };
    case 'RSA':
      return { e: jwk.e ?? '', kty: 'RSA', n: jwk.n ?? '' };
    default:
      throw new Error(`unsupported kty: ${jwk.kty}`);
  }
}

export function canonicalJwkJson(jwk: Jwk): string {
  const members = canonicalJwkMembers(jwk);
  const sortedKeys = Object.keys(members).sort();
  return `{${sortedKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(members[k])}`).join(',')}}`;
}

export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  const json = canonicalJwkJson(jwk);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
