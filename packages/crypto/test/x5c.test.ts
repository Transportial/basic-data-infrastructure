// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { base64UrlEncode } from '@bdi/kernel';
import { verifyX5cChain, computeCertThumbprintSha256 } from '../src/x5c.ts';

// Build a synthetic "certificate" DER that is just a SEQUENCE containing a
// TBSCertificate SEQUENCE with [0] EXPLICIT version, serial (integer),
// sigAlg (sequence), issuer (sequence), validity (sequence), subject
// (sequence), and a SPKI (sequence containing algId + bit-string) — enough
// for the SPKI extractor to walk.
function buildCert(spkiBytes: Uint8Array): Uint8Array {
  const version = Uint8Array.of(0xa0, 0x03, 0x02, 0x01, 0x02); // [0] EXPLICIT INT 2
  const serial = Uint8Array.of(0x02, 0x01, 0x01); // INTEGER 1
  const sigAlg = seq(seq(oidBytes('1.2'))); // trivial alg
  const issuer = seq();
  const validity = seq();
  const subject = seq();
  const spki = wrap(spkiBytes);
  const tbs = seq(version, serial, sigAlg, issuer, validity, subject, spki);
  const outerSigAlg = seq(oidBytes('1.2'));
  const outerSig = Uint8Array.of(0x03, 0x02, 0x00, 0x00);
  return seq(tbs, outerSigAlg, outerSig);
}

function seq(...children: Uint8Array[]): Uint8Array {
  const body = concat(...children);
  return tlv(0x30, body);
}

function wrap(raw: Uint8Array): Uint8Array {
  return Uint8Array.from(raw);
}

function tlv(tag: number, body: Uint8Array): Uint8Array {
  const len = encodeLen(body.length);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function encodeLen(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  if (n < 0x100) return Uint8Array.of(0x81, n);
  if (n < 0x10000) return Uint8Array.of(0x82, (n >> 8) & 0xff, n & 0xff);
  return Uint8Array.of(0x83, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function oidBytes(dotted: string): Uint8Array {
  const parts = dotted.split('.').map((s) => Number(s));
  const body: number[] = [parts[0]! * 40 + (parts[1] ?? 0)];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]!;
    const enc: number[] = [];
    do {
      enc.unshift(v & 0x7f);
      v >>= 7;
    } while (v > 0);
    for (let j = 0; j < enc.length - 1; j++) enc[j]! |= 0x80;
    body.push(...enc);
  }
  return tlv(0x06, Uint8Array.from(body));
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe('verifyX5cChain', () => {
  test('empty chain fails', async () => {
    const r = await verifyX5cChain([], { trustedSpkiSha256: new Set() });
    expect(r?.type).toBe('empty-chain');
  });

  test('chain exceeding maxDepth fails', async () => {
    const r = await verifyX5cChain(['a', 'b', 'c', 'd', 'e', 'f'], {
      trustedSpkiSha256: new Set(),
      maxDepth: 3,
    });
    expect(r?.type).toBe('too-deep');
  });

  test('malformed cert fails', async () => {
    const r = await verifyX5cChain(['this!is!not@base64'], { trustedSpkiSha256: new Set() });
    // base64 decode usually succeeds on arbitrary ascii — structural parse
    // will reject instead.
    expect(r?.type).toBeDefined();
  });

  test('unknown anchor fails', async () => {
    // Build a cert with a known SPKI, but the anchor set doesn't contain its hash.
    const spki = seq(seq(oidBytes('1.2')), Uint8Array.of(0x03, 0x02, 0x00, 0xaa));
    const cert = buildCert(spki);
    const r = await verifyX5cChain([toB64(cert)], { trustedSpkiSha256: new Set(['other']) });
    expect(r?.type).toBe('not-anchored');
  });

  test('accepts when anchor matches', async () => {
    const spki = seq(seq(oidBytes('1.2')), Uint8Array.of(0x03, 0x02, 0x00, 0xab));
    const cert = buildCert(spki);
    // Compute the hash of the embedded SPKI (what the verifier anchors on).
    const spkiHash = await import('../src/x5c.ts').then(() => null);
    void spkiHash;
    // Easier: call verifyX5cChain and capture the reported thumbprint, then retry with it as the trusted hash.
    const first = await verifyX5cChain([toB64(cert)], { trustedSpkiSha256: new Set(['anything']) });
    if (!first || first.type !== 'not-anchored') throw new Error('expected not-anchored');
    const r = await verifyX5cChain([toB64(cert)], {
      trustedSpkiSha256: new Set([first.leafThumbprint]),
    });
    expect(r).toBeNull();
  });
});

describe('computeCertThumbprintSha256', () => {
  test('produces a base64url string', async () => {
    const spki = seq(seq(oidBytes('1.2')), Uint8Array.of(0x03, 0x02, 0x00, 0xab));
    const cert = buildCert(spki);
    const tp = await computeCertThumbprintSha256(toB64(cert));
    expect(tp).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tp.length).toBeGreaterThan(20);
  });
});

// unused
void base64UrlEncode;
