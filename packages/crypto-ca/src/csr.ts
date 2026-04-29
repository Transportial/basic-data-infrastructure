// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Jwk, type Result } from '@transportial/kernel';
import {
  parseTlv,
  TAG_SEQUENCE,
  TAG_BIT_STRING,
  TAG_OID,
  TAG_SET,
  TAG_OCTET_STRING,
} from './der.ts';
import { OID } from './oid.ts';

export type CsrParseError =
  | { type: 'malformed' }
  | { type: 'unsupported-version' }
  | { type: 'unsupported-pubkey' }
  | { type: 'missing-san' };

export interface CertificationRequest {
  readonly subject: Map<string, string>;
  readonly publicKeyDer: Uint8Array;
  readonly publicKeyJwk: Jwk;
  readonly sanDnsNames: ReadonlyArray<string>;
  readonly sanUris: ReadonlyArray<string>;
  readonly signatureAlgorithm: string;
  readonly tbsCertificationRequest: Uint8Array;
  readonly signatureValue: Uint8Array;
}

// Parse a PKCS#10 Certification Request (RFC 2986) from DER bytes. We extract
// subject, SPKI, requested SANs (for server/client auth), the signature and
// the TBS blob so the CA can verify proof-of-possession before signing.
export function parseCsr(der: Uint8Array): Result<CertificationRequest, CsrParseError> {
  try {
    const outer = parseTlv(der);
    if (outer.tag !== TAG_SEQUENCE) return err({ type: 'malformed' });

    const tbs = parseTlv(outer.body, 0);
    if (tbs.tag !== TAG_SEQUENCE) return err({ type: 'malformed' });
    const sigAlg = parseTlv(outer.body, tbs.total.byteLength);
    if (sigAlg.tag !== TAG_SEQUENCE) return err({ type: 'malformed' });
    const sig = parseTlv(outer.body, tbs.total.byteLength + sigAlg.total.byteLength);
    if (sig.tag !== TAG_BIT_STRING) return err({ type: 'malformed' });

    const version = parseTlv(tbs.body, 0);
    if (version.tag !== 0x02) return err({ type: 'malformed' });
    if (version.body[0] !== 0) return err({ type: 'unsupported-version' });

    const subject = parseTlv(tbs.body, version.total.byteLength);
    if (subject.tag !== TAG_SEQUENCE) return err({ type: 'malformed' });
    const spki = parseTlv(tbs.body, version.total.byteLength + subject.total.byteLength);
    if (spki.tag !== TAG_SEQUENCE) return err({ type: 'malformed' });
    const attrs = parseTlv(
      tbs.body,
      version.total.byteLength + subject.total.byteLength + spki.total.byteLength,
    );

    const subjectMap = parseName(subject.body);
    const pub = parseSpki(spki.total);
    if (!pub) return err({ type: 'unsupported-pubkey' });

    const dns: string[] = [];
    const uris: string[] = [];
    if (attrs.tag === 0xa0) {
      // context-specific [0] IMPLICIT SET OF Attribute
      const attrsBody = attrs.body;
      let off = 0;
      while (off < attrsBody.byteLength) {
        const attr = parseTlv(attrsBody, off);
        off += attr.total.byteLength;
        if (attr.tag !== TAG_SEQUENCE) continue;
        const idOid = parseTlv(attr.body, 0);
        const values = parseTlv(attr.body, idOid.total.byteLength);
        if (idOid.tag !== TAG_OID) continue;
        const oidStr = decodeOid(idOid.body);
        if (oidStr !== OID.extensionRequest) continue;
        if (values.tag !== TAG_SET) continue;
        const extensions = parseTlv(values.body, 0);
        if (extensions.tag !== TAG_SEQUENCE) continue;
        let eOff = 0;
        while (eOff < extensions.body.byteLength) {
          const ext = parseTlv(extensions.body, eOff);
          eOff += ext.total.byteLength;
          if (ext.tag !== TAG_SEQUENCE) continue;
          const extId = parseTlv(ext.body, 0);
          let critOff = extId.total.byteLength;
          let critical = false;
          const maybeCrit = parseTlv(ext.body, critOff);
          if (maybeCrit.tag === 0x01) {
            critical = maybeCrit.body[0] === 0xff;
            critOff += maybeCrit.total.byteLength;
          }
          const extValue = parseTlv(ext.body, critOff);
          if (extId.tag !== TAG_OID) continue;
          const extIdStr = decodeOid(extId.body);
          if (extIdStr === OID.extSubjectAltName && extValue.tag === TAG_OCTET_STRING) {
            parseSanInto(extValue.body, dns, uris);
          }
          void critical;
        }
      }
    }

    const sigAlgOid = parseTlv(sigAlg.body, 0);
    const sigAlgorithm =
      sigAlgOid.tag === TAG_OID ? decodeOid(sigAlgOid.body) : 'unknown';

    return ok({
      subject: subjectMap,
      publicKeyDer: spki.total,
      publicKeyJwk: pub,
      sanDnsNames: dns,
      sanUris: uris,
      signatureAlgorithm: sigAlgorithm,
      tbsCertificationRequest: tbs.total,
      signatureValue: sig.body.slice(1),
    });
  } catch {
    return err({ type: 'malformed' });
  }
}

function parseName(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let off = 0;
  while (off < bytes.byteLength) {
    const rdn = parseTlv(bytes, off);
    off += rdn.total.byteLength;
    if (rdn.tag !== TAG_SET) continue;
    let rdnOff = 0;
    while (rdnOff < rdn.body.byteLength) {
      const atv = parseTlv(rdn.body, rdnOff);
      rdnOff += atv.total.byteLength;
      if (atv.tag !== TAG_SEQUENCE) continue;
      const attrOid = parseTlv(atv.body, 0);
      const attrValue = parseTlv(atv.body, attrOid.total.byteLength);
      if (attrOid.tag !== TAG_OID) continue;
      out.set(decodeOid(attrOid.body), new TextDecoder().decode(attrValue.body));
    }
  }
  return out;
}

function parseSanInto(octetBytes: Uint8Array, dns: string[], uris: string[]): void {
  const outer = parseTlv(octetBytes, 0);
  if (outer.tag !== TAG_SEQUENCE) return;
  let off = 0;
  while (off < outer.body.byteLength) {
    const gn = parseTlv(outer.body, off);
    off += gn.total.byteLength;
    const selector = gn.tag & 0x1f;
    const text = new TextDecoder().decode(gn.body);
    if (selector === 2) dns.push(text);
    else if (selector === 6) uris.push(text);
  }
}

export function decodeOid(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return '';
  const first = bytes[0]!;
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let acc = 0;
  for (let i = 1; i < bytes.byteLength; i++) {
    const b = bytes[i]!;
    acc = (acc << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(acc);
      acc = 0;
    }
  }
  return parts.join('.');
}

function parseSpki(spki: Uint8Array): Jwk | null {
  const outer = parseTlv(spki);
  if (outer.tag !== TAG_SEQUENCE) return null;
  const algId = parseTlv(outer.body, 0);
  if (algId.tag !== TAG_SEQUENCE) return null;
  const pubBits = parseTlv(outer.body, algId.total.byteLength);
  if (pubBits.tag !== TAG_BIT_STRING) return null;
  const algOid = parseTlv(algId.body, 0);
  const oidStr = decodeOid(algOid.body);

  if (oidStr === OID.ecPublicKey) {
    const curveOid = parseTlv(algId.body, algOid.total.byteLength);
    const curveStr = curveOid.tag === TAG_OID ? decodeOid(curveOid.body) : '';
    const uncompressed = pubBits.body.slice(1);
    if (uncompressed[0] !== 0x04) return null;
    const half = (uncompressed.byteLength - 1) / 2;
    const x = uncompressed.slice(1, 1 + half);
    const y = uncompressed.slice(1 + half);
    if (curveStr === OID.p256) {
      return { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) };
    }
    if (curveStr === OID.p384) {
      return { kty: 'EC', crv: 'P-384', x: b64url(x), y: b64url(y) };
    }
    return null;
  }
  if (oidStr === OID.ed25519) {
    const rawPub = pubBits.body.slice(1);
    return { kty: 'OKP', crv: 'Ed25519', x: b64url(rawPub) };
  }
  if (oidStr === OID.rsaEncryption) {
    // pubBits.body is a BIT STRING wrapping a RSAPublicKey sequence
    const inner = parseTlv(pubBits.body.slice(1));
    if (inner.tag !== TAG_SEQUENCE) return null;
    const n = parseTlv(inner.body, 0);
    const e = parseTlv(inner.body, n.total.byteLength);
    return {
      kty: 'RSA',
      n: b64url(trimLeadingZero(n.body)),
      e: b64url(trimLeadingZero(e.body)),
    };
  }
  return null;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function trimLeadingZero(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0 ? bytes.slice(1) : bytes;
}

// Verify the CSR's signature against its own subject public key. This proves
// proof-of-possession before we sign a certificate.
export async function verifyCsrSignature(csr: CertificationRequest): Promise<boolean> {
  const algo = sigAlgParams(csr.signatureAlgorithm);
  if (!algo) return false;
  const key = await crypto.subtle.importKey(
    'jwk',
    csr.publicKeyJwk as unknown as JsonWebKey,
    algo.importAlg,
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    algo.verifyAlg,
    key,
    toBuffer(csr.signatureValue),
    toBuffer(csr.tbsCertificationRequest),
  );
}

function sigAlgParams(
  oidStr: string,
): { importAlg: AlgorithmIdentifier | EcKeyImportParams | RsaHashedImportParams; verifyAlg: AlgorithmIdentifier | EcdsaParams | RsaPssParams } | null {
  switch (oidStr) {
    case OID.ecdsaWithSha256:
      return {
        importAlg: { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyImportParams,
        verifyAlg: { name: 'ECDSA', hash: { name: 'SHA-256' } } as EcdsaParams,
      };
    case OID.ecdsaWithSha384:
      return {
        importAlg: { name: 'ECDSA', namedCurve: 'P-384' } as EcKeyImportParams,
        verifyAlg: { name: 'ECDSA', hash: { name: 'SHA-384' } } as EcdsaParams,
      };
    case OID.ed25519:
      return {
        importAlg: { name: 'Ed25519' },
        verifyAlg: { name: 'Ed25519' },
      };
    case OID.sha256WithRSAEncryption:
      return {
        importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } } as RsaHashedImportParams,
        verifyAlg: { name: 'RSASSA-PKCS1-v1_5' } as AlgorithmIdentifier,
      };
    default:
      return null;
  }
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}
