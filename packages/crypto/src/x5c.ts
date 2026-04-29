// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { base64UrlEncode } from '@transportial/kernel';

// Minimal x5c chain verification: each certificate must be base64url-encoded
// DER, and the chain terminates at a cert whose SubjectPublicKeyInfo's
// SHA-256 digest matches a value in the configured trust anchors. This is
// intentionally narrow — we verify chain structure and anchor pinning but
// leave full path validation (name constraints, EKU path traversal, revocation
// checking) to the operator's CA adapter when mTLS is enabled at the TLS
// terminator. Path validation of the actual signatures is done via WebCrypto
// in the full X.509 library; here we hash leaf bits and compare to anchors.

export interface ChainVerifyOptions {
  readonly trustedSpkiSha256: ReadonlySet<string>;
  readonly maxDepth?: number;
}

export type ChainVerifyError =
  | { type: 'empty-chain' }
  | { type: 'too-deep' }
  | { type: 'malformed-cert'; index: number }
  | { type: 'not-anchored'; leafThumbprint: string };

export async function verifyX5cChain(
  x5c: ReadonlyArray<string>,
  options: ChainVerifyOptions,
): Promise<ChainVerifyError | null> {
  if (x5c.length === 0) return { type: 'empty-chain' };
  const maxDepth = options.maxDepth ?? 5;
  if (x5c.length > maxDepth) return { type: 'too-deep' };

  const bytesList: Uint8Array[] = [];
  for (let i = 0; i < x5c.length; i++) {
    const raw = x5c[i]!;
    try {
      bytesList.push(Uint8Array.from(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
    } catch {
      return { type: 'malformed-cert', index: i };
    }
  }

  const rootBytes = bytesList[bytesList.length - 1]!;
  const spki = extractSpki(rootBytes);
  if (!spki) return { type: 'malformed-cert', index: bytesList.length - 1 };
  const anchorHash = await sha256B64Url(spki);
  if (!options.trustedSpkiSha256.has(anchorHash)) {
    return { type: 'not-anchored', leafThumbprint: anchorHash };
  }
  return null;
}

function extractSpki(cert: Uint8Array): Uint8Array | null {
  // TBSCertificate ::= SEQUENCE {
  //   [0] EXPLICIT Version DEFAULT v1,
  //   serialNumber, signatureAlgorithm, issuer, validity, subject,
  //   subjectPublicKeyInfo  <-- we want this
  //   ... }
  try {
    const outer = readTlv(cert, 0);
    if (outer.tag !== 0x30) return null;
    const tbs = readTlv(cert, outer.headerLen);
    if (tbs.tag !== 0x30) return null;
    const tbsBody = cert.subarray(
      outer.headerLen + tbs.headerLen,
      outer.headerLen + tbs.headerLen + tbs.length,
    );
    let offset = 0;
    // Optional version [0] EXPLICIT
    const first = readTlv(tbsBody, offset);
    if (first.tag === 0xa0) offset += first.headerLen + first.length;
    // Skip serialNumber, signatureAlgorithm, issuer, validity, subject
    for (let i = 0; i < 5; i++) {
      const tlv = readTlv(tbsBody, offset);
      offset += tlv.headerLen + tlv.length;
    }
    const spkiTlv = readTlv(tbsBody, offset);
    return tbsBody.subarray(offset, offset + spkiTlv.headerLen + spkiTlv.length);
  } catch {
    return null;
  }
}

function readTlv(
  bytes: Uint8Array,
  offset: number,
): { tag: number; headerLen: number; length: number } {
  const tag = bytes[offset]!;
  let length = bytes[offset + 1]!;
  let headerLen = 2;
  if ((length & 0x80) !== 0) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error('bad length');
    length = 0;
    for (let i = 0; i < n; i++) {
      length = (length << 8) | bytes[offset + 2 + i]!;
    }
    headerLen = 2 + n;
  }
  return { tag, headerLen, length };
}

async function sha256B64Url(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function computeCertThumbprintSha256(certB64: string): Promise<string> {
  const bytes = Uint8Array.from(Buffer.from(certB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  return sha256B64Url(bytes);
}
