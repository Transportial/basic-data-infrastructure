// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  bitString,
  boolean,
  explicit,
  generalizedTime,
  ia5,
  implicit,
  integer,
  nullValue,
  octetString,
  oid,
  parseTlv,
  printableString,
  sequence,
  set,
  tlv,
  utcTime,
  utf8,
} from '../src/der.ts';

describe('DER primitives', () => {
  test('tlv encodes short and long lengths', () => {
    const short = tlv(0x04, new Uint8Array(10));
    expect(short.length).toBe(12);
    const long = tlv(0x04, new Uint8Array(200));
    expect(long[1]).toBe(0x81);
    const longer = tlv(0x04, new Uint8Array(1000));
    expect(longer[1]).toBe(0x82);
    const huge = tlv(0x04, new Uint8Array(0x10001));
    expect(huge[1]).toBe(0x83);
  });

  test('integer encodes small and large values', () => {
    expect(integer(0)).toEqual(Uint8Array.of(0x02, 0x01, 0x00));
    const positive = integer(1n);
    expect(positive).toEqual(Uint8Array.of(0x02, 0x01, 0x01));
    // Leading zero preserved for positive sign
    const high = integer(0x80n);
    expect(high).toEqual(Uint8Array.of(0x02, 0x02, 0x00, 0x80));
  });

  test('integer accepts negative input (absolute magnitude)', () => {
    const negative = integer(-1n);
    expect(negative[0]).toBe(0x02);
  });

  test('oid encodes well-known oid', () => {
    const o = oid('1.2.840.113549.1.1.1');
    expect(o[0]).toBe(0x06);
    expect(o[1]).toBeGreaterThan(0);
  });

  test('oid rejects invalid input', () => {
    expect(() => oid('42')).toThrow();
  });

  test('sequence, set and wrappers work', () => {
    const s = sequence(integer(1), integer(2));
    expect(s[0]).toBe(0x30);
    const ss = set(integer(1));
    expect(ss[0]).toBe(0x31);
    expect(octetString(new Uint8Array([1, 2]))[0]).toBe(0x04);
    expect(utf8('hi')[0]).toBe(0x0c);
    expect(printableString('DE')[0]).toBe(0x13);
    expect(ia5('x')[0]).toBe(0x16);
    expect(utcTime(new Date('2026-04-23T00:00:00Z'))[0]).toBe(0x17);
    expect(generalizedTime(new Date('2126-04-23T00:00:00Z'))[0]).toBe(0x18);
    expect(nullValue()).toEqual(Uint8Array.of(0x05, 0x00));
    expect(boolean(true)).toEqual(Uint8Array.of(0x01, 0x01, 0xff));
    expect(boolean(false)).toEqual(Uint8Array.of(0x01, 0x01, 0x00));
    expect(explicit(0, integer(1))[0]).toBe(0xa0);
    expect(implicit(2, new TextEncoder().encode('x'))[0]).toBe(0x82);
  });

  test('bitString preserves unused-bit count', () => {
    const b = bitString(Uint8Array.of(0x80), 7);
    expect(b[0]).toBe(0x03);
    expect(b[1]).toBe(0x02);
    expect(b[2]).toBe(7);
    expect(b[3]).toBe(0x80);
  });

  test('parseTlv roundtrips our encoded values', () => {
    const payload = sequence(integer(1), integer(2));
    const parsed = parseTlv(payload);
    expect(parsed.tag).toBe(0x30);
    const first = parseTlv(parsed.body, 0);
    expect(first.tag).toBe(0x02);
  });

  test('parseTlv rejects truncated data', () => {
    expect(() => parseTlv(new Uint8Array(0))).toThrow();
  });

  test('parseTlv accepts multi-byte lengths', () => {
    const body = new Uint8Array(300);
    const encoded = tlv(0x04, body);
    const parsed = parseTlv(encoded);
    expect(parsed.length).toBe(300);
  });
});
