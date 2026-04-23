// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Jwk } from '@bdi/kernel';
import { base64UrlDecode } from '@bdi/kernel';
import {
  bitString,
  integer,
  nullValue,
  oid,
  parseTlv,
  sequence,
  TAG_BIT_STRING,
  TAG_SEQUENCE,
} from './der.ts';
import { OID } from './oid.ts';

// Build an X.509 SubjectPublicKeyInfo from a JWK. Supports EC (P-256, P-384),
// Ed25519, and RSA (PKCS#1 v1.5 signing keys). Returns the raw DER bytes.
export function jwkToSpki(jwk: Jwk): Uint8Array {
  switch (jwk.kty) {
    case 'EC':
      return ecSpki(jwk);
    case 'OKP':
      return okpSpki(jwk);
    case 'RSA':
      return rsaSpki(jwk);
    default:
      throw new Error(`unsupported kty: ${jwk.kty}`);
  }
}

function ecSpki(jwk: Jwk): Uint8Array {
  const crv = jwk.crv ?? '';
  const curveOid =
    crv === 'P-256'
      ? OID.p256
      : crv === 'P-384'
        ? OID.p384
        : (() => {
            throw new Error(`unsupported EC curve: ${crv}`);
          })();
  if (!jwk.x || !jwk.y) throw new Error('EC jwk missing x/y');
  const x = base64UrlDecode(jwk.x);
  const y = base64UrlDecode(jwk.y);
  const uncompressed = concat(Uint8Array.of(0x04), x, y);
  const algId = sequence(oid(OID.ecPublicKey), oid(curveOid));
  return sequence(algId, bitString(uncompressed));
}

function okpSpki(jwk: Jwk): Uint8Array {
  if (jwk.crv !== 'Ed25519') throw new Error(`unsupported OKP curve: ${jwk.crv}`);
  if (!jwk.x) throw new Error('OKP jwk missing x');
  const rawPub = base64UrlDecode(jwk.x);
  const algId = sequence(oid(OID.ed25519));
  return sequence(algId, bitString(rawPub));
}

function rsaSpki(jwk: Jwk): Uint8Array {
  if (!jwk.n || !jwk.e) throw new Error('RSA jwk missing n/e');
  const n = base64UrlDecode(jwk.n);
  const e = base64UrlDecode(jwk.e);
  const rsaKey = sequence(integerFromBytes(n), integerFromBytes(e));
  const algId = sequence(oid(OID.rsaEncryption), nullValue());
  return sequence(algId, bitString(rsaKey));
}

function integerFromBytes(bytes: Uint8Array): Uint8Array {
  // Trim leading zero bytes (keep one if high bit set to preserve sign).
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.slice(i);
  const leadingByte = trimmed[0] ?? 0;
  const body = leadingByte & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed;
  const out = new Uint8Array(body.byteLength + 2);
  out[0] = 0x02;
  out[1] = body.byteLength;
  out.set(body, 2);
  // This is a primitive TLV we reassemble; rebuild via integer() for lengths > 127.
  if (body.byteLength < 128) return out;
  return rebuildInteger(body);
}

function rebuildInteger(body: Uint8Array): Uint8Array {
  return integer(bigintFromBody(body));
}

function bigintFromBody(body: Uint8Array): bigint {
  let n = 0n;
  for (const b of body) n = (n << 8n) | BigInt(b);
  return n;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

// Given a DER-encoded SubjectPublicKeyInfo, extract the raw public key bytes
// (suitable for computing the SKI as SHA-256 of the bit-string contents).
export function spkiPublicKeyBytes(spki: Uint8Array): Uint8Array {
  const outer = parseTlv(spki);
  if (outer.tag !== TAG_SEQUENCE) throw new Error('spki: not a sequence');
  // skip algIdentifier
  const algId = parseTlv(outer.body, 0);
  if (algId.tag !== TAG_SEQUENCE) throw new Error('spki: alg id not a sequence');
  const bitStringTlv = parseTlv(outer.body, algId.total.byteLength);
  if (bitStringTlv.tag !== TAG_BIT_STRING) throw new Error('spki: not a bit string');
  return bitStringTlv.body.slice(1);
}
