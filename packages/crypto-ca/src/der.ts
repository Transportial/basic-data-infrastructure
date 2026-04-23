// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

// Minimal ASN.1 DER writer sufficient to build PKCS#10 CSRs, X.509v3 certs,
// and the SignatureAlgorithm + Extensions we emit. This is *not* a general
// ASN.1 library; it's a narrow, auditable subset.

export type Tag = number;

export const TAG_BOOLEAN = 0x01;
export const TAG_INTEGER = 0x02;
export const TAG_BIT_STRING = 0x03;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_UTF8STRING = 0x0c;
export const TAG_PRINTABLESTRING = 0x13;
export const TAG_IA5STRING = 0x16;
export const TAG_UTCTIME = 0x17;
export const TAG_GENERALIZEDTIME = 0x18;
export const TAG_SEQUENCE = 0x30;
export const TAG_SET = 0x31;

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  if (len < 0x100) return Uint8Array.of(0x81, len);
  if (len < 0x10000) return Uint8Array.of(0x82, (len >> 8) & 0xff, len & 0xff);
  if (len < 0x1000000)
    return Uint8Array.of(0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  return Uint8Array.of(
    0x84,
    (len >>> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  );
}

export function concat(...chunks: Uint8Array[]): Uint8Array {
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

export function tlv(tag: Tag, body: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag), encodeLength(body.byteLength), body);
}

export function sequence(...children: Uint8Array[]): Uint8Array {
  return tlv(TAG_SEQUENCE, concat(...children));
}

export function set(...children: Uint8Array[]): Uint8Array {
  return tlv(TAG_SET, concat(...children));
}

export function integer(value: number | bigint): Uint8Array {
  const n = typeof value === 'number' ? BigInt(value) : value;
  if (n === 0n) return tlv(TAG_INTEGER, Uint8Array.of(0x00));
  const bytes: number[] = [];
  let v = n < 0n ? -n : n;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  // Ensure positive encoding (leading zero if high bit set)
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0);
  return tlv(TAG_INTEGER, Uint8Array.from(bytes));
}

export function bigintFromBytes(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map((s) => Number.parseInt(s, 10));
  if (parts.length < 2) throw new Error(`invalid oid: ${dotted}`);
  const first = parts[0]! * 40 + parts[1]!;
  const out: number[] = [first];
  for (let i = 2; i < parts.length; i++) {
    const encoded: number[] = [];
    let v = parts[i]!;
    do {
      encoded.unshift(v & 0x7f);
      v >>= 7;
    } while (v > 0);
    for (let j = 0; j < encoded.length - 1; j++) encoded[j]! |= 0x80;
    out.push(...encoded);
  }
  return tlv(TAG_OID, Uint8Array.from(out));
}

export function octetString(bytes: Uint8Array): Uint8Array {
  return tlv(TAG_OCTET_STRING, bytes);
}

export function utf8(s: string): Uint8Array {
  return tlv(TAG_UTF8STRING, new TextEncoder().encode(s));
}

export function printableString(s: string): Uint8Array {
  return tlv(TAG_PRINTABLESTRING, new TextEncoder().encode(s));
}

export function ia5(s: string): Uint8Array {
  return tlv(TAG_IA5STRING, new TextEncoder().encode(s));
}

export function utcTime(d: Date): Uint8Array {
  const fmt = (n: number) => n.toString().padStart(2, '0');
  const yy = fmt(d.getUTCFullYear() % 100);
  const s =
    yy +
    fmt(d.getUTCMonth() + 1) +
    fmt(d.getUTCDate()) +
    fmt(d.getUTCHours()) +
    fmt(d.getUTCMinutes()) +
    fmt(d.getUTCSeconds()) +
    'Z';
  return tlv(TAG_UTCTIME, new TextEncoder().encode(s));
}

export function generalizedTime(d: Date): Uint8Array {
  const fmt = (n: number, w = 2) => n.toString().padStart(w, '0');
  const s =
    fmt(d.getUTCFullYear(), 4) +
    fmt(d.getUTCMonth() + 1) +
    fmt(d.getUTCDate()) +
    fmt(d.getUTCHours()) +
    fmt(d.getUTCMinutes()) +
    fmt(d.getUTCSeconds()) +
    'Z';
  return tlv(TAG_GENERALIZEDTIME, new TextEncoder().encode(s));
}

export function bitString(data: Uint8Array, unusedBits = 0): Uint8Array {
  const body = new Uint8Array(data.byteLength + 1);
  body[0] = unusedBits;
  body.set(data, 1);
  return tlv(TAG_BIT_STRING, body);
}

export function nullValue(): Uint8Array {
  return tlv(TAG_NULL, new Uint8Array(0));
}

export function boolean(value: boolean): Uint8Array {
  return tlv(TAG_BOOLEAN, Uint8Array.of(value ? 0xff : 0x00));
}

export function explicit(tagNumber: number, body: Uint8Array): Uint8Array {
  // Context-specific constructed tag: 0xA0 | tagNumber
  return tlv(0xa0 | tagNumber, body);
}

export function implicit(tagNumber: number, body: Uint8Array): Uint8Array {
  // Context-specific primitive tag: 0x80 | tagNumber
  return tlv(0x80 | tagNumber, body);
}

// Parse a DER-encoded value and return tag + length + body slice.
export interface ParsedTlv {
  readonly tag: number;
  readonly headerBytes: number;
  readonly length: number;
  readonly body: Uint8Array;
  readonly total: Uint8Array;
}

export function parseTlv(bytes: Uint8Array, offset = 0): ParsedTlv {
  if (offset >= bytes.byteLength) throw new Error('truncated');
  const tag = bytes[offset]!;
  let length = bytes[offset + 1]!;
  let headerBytes = 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error('bad length');
    length = 0;
    for (let i = 0; i < n; i++) {
      length = (length << 8) | bytes[offset + 2 + i]!;
    }
    headerBytes = 2 + n;
  }
  if (offset + headerBytes + length > bytes.byteLength) throw new Error('truncated body');
  const body = bytes.slice(offset + headerBytes, offset + headerBytes + length);
  const total = bytes.slice(offset, offset + headerBytes + length);
  return { tag, headerBytes, length, body, total };
}
