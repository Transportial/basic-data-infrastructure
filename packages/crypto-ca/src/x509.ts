// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { Jwk } from '@bdi/kernel';
import { base64UrlEncode } from '@bdi/kernel';
import {
  bitString,
  boolean,
  concat,
  explicit,
  generalizedTime,
  implicit,
  integer,
  nullValue,
  octetString,
  oid,
  printableString,
  set,
  sequence,
  tlv,
  utcTime,
  utf8,
} from './der.ts';
import { OID } from './oid.ts';
import { jwkToSpki, spkiPublicKeyBytes } from './spki.ts';

export interface SubjectDn {
  readonly commonName: string;
  readonly organization?: string;
  readonly organizationalUnit?: string;
  readonly country?: string;
  readonly locality?: string;
  readonly state?: string;
  readonly organizationIdentifier?: string;
}

export type KeyUsageBits = {
  readonly digitalSignature?: boolean;
  readonly nonRepudiation?: boolean;
  readonly keyEncipherment?: boolean;
  readonly dataEncipherment?: boolean;
  readonly keyAgreement?: boolean;
  readonly keyCertSign?: boolean;
  readonly cRLSign?: boolean;
};

export interface CertProfile {
  readonly serial: bigint;
  readonly subject: SubjectDn;
  readonly issuer: SubjectDn;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly subjectPublicKeyJwk: Jwk;
  readonly issuerPublicKeyJwk: Jwk;
  readonly isCa: boolean;
  readonly pathLenConstraint?: number;
  readonly keyUsage?: KeyUsageBits;
  readonly extendedKeyUsages?: ReadonlyArray<string>;
  readonly sanDns?: ReadonlyArray<string>;
  readonly sanUris?: ReadonlyArray<string>;
  readonly crlDistributionUrl?: string;
  readonly ocspUrl?: string;
  readonly caIssuersUrl?: string;
}

export interface SignedCertificate {
  readonly der: Uint8Array;
  readonly tbs: Uint8Array;
  readonly signatureAlgorithm: string;
}

// Build a to-be-signed X.509 v3 certificate tbsCertificate structure and a
// "complete cert minus signature" placeholder. The caller signs the TBS and
// calls `attachSignature` to emit the final DER-encoded Certificate.
export function buildTbsCertificate(profile: CertProfile, signatureAlgOid: string): Uint8Array {
  const version = explicit(0, integer(2));
  const serial = integer(profile.serial);
  const sigAlg = algorithmIdentifier(signatureAlgOid);
  const issuer = buildName(profile.issuer);
  const validity = sequence(
    profile.notBefore.getUTCFullYear() < 2050 ? utcTime(profile.notBefore) : generalizedTime(profile.notBefore),
    profile.notAfter.getUTCFullYear() < 2050 ? utcTime(profile.notAfter) : generalizedTime(profile.notAfter),
  );
  const subject = buildName(profile.subject);
  const spki = jwkToSpki(profile.subjectPublicKeyJwk);

  const extensions = buildExtensions(profile);
  return sequence(version, serial, sigAlg, issuer, validity, subject, spki, extensions);
}

export function attachSignature(
  tbs: Uint8Array,
  signatureAlgOid: string,
  signature: Uint8Array,
): Uint8Array {
  return sequence(tbs, algorithmIdentifier(signatureAlgOid), bitString(signature));
}

function algorithmIdentifier(algOid: string): Uint8Array {
  // For EC/Ed25519 there are no parameters; for RSA we emit NULL params.
  const needsNullParams =
    algOid === OID.sha256WithRSAEncryption || algOid === OID.rsaEncryption;
  return needsNullParams ? sequence(oid(algOid), nullValue()) : sequence(oid(algOid));
}

function buildName(dn: SubjectDn): Uint8Array {
  const rdns: Uint8Array[] = [];
  const push = (attrOid: string, value: string | undefined, printable = false) => {
    if (!value) return;
    const stringTlv = printable ? printableString(value) : utf8(value);
    rdns.push(set(sequence(oid(attrOid), stringTlv)));
  };
  push(OID.country, dn.country, true);
  push(OID.stateOrProvince, dn.state);
  push(OID.locality, dn.locality);
  push(OID.organizationName, dn.organization);
  push(OID.organizationalUnit, dn.organizationalUnit);
  push(OID.organizationIdentifier, dn.organizationIdentifier);
  push(OID.commonName, dn.commonName);
  return sequence(...rdns);
}

function buildExtensions(profile: CertProfile): Uint8Array {
  const exts: Uint8Array[] = [];

  // basicConstraints (critical)
  if (profile.isCa) {
    const body =
      profile.pathLenConstraint !== undefined
        ? sequence(boolean(true), integer(profile.pathLenConstraint))
        : sequence(boolean(true));
    exts.push(makeExtension(OID.extBasicConstraints, true, body));
  } else {
    exts.push(makeExtension(OID.extBasicConstraints, true, sequence()));
  }

  if (profile.keyUsage) {
    exts.push(makeExtension(OID.extKeyUsage, true, encodeKeyUsage(profile.keyUsage)));
  }

  if (profile.extendedKeyUsages?.length) {
    const body = sequence(...profile.extendedKeyUsages.map((o) => oid(o)));
    exts.push(makeExtension(OID.extExtendedKeyUsage, false, body));
  }

  // subjectKeyIdentifier
  const subjectSpki = jwkToSpki(profile.subjectPublicKeyJwk);
  const ski = sha1Sync(spkiPublicKeyBytes(subjectSpki));
  exts.push(makeExtension(OID.extSubjectKeyIdentifier, false, octetString(ski)));

  // authorityKeyIdentifier
  const issuerSpki = jwkToSpki(profile.issuerPublicKeyJwk);
  const aki = sha1Sync(spkiPublicKeyBytes(issuerSpki));
  exts.push(
    makeExtension(
      OID.extAuthorityKeyIdentifier,
      false,
      sequence(implicit(0, aki)),
    ),
  );

  const sanEntries: Uint8Array[] = [];
  for (const d of profile.sanDns ?? []) sanEntries.push(implicit(2, new TextEncoder().encode(d)));
  for (const u of profile.sanUris ?? []) sanEntries.push(implicit(6, new TextEncoder().encode(u)));
  if (sanEntries.length > 0) {
    exts.push(makeExtension(OID.extSubjectAltName, false, sequence(...sanEntries)));
  }

  if (profile.crlDistributionUrl) {
    const fullName = implicit(0, sequence(implicit(6, new TextEncoder().encode(profile.crlDistributionUrl))));
    const distPoint = sequence(explicit(0, fullName));
    exts.push(makeExtension(OID.extCrlDistributionPoints, false, sequence(distPoint)));
  }

  if (profile.ocspUrl || profile.caIssuersUrl) {
    const accessDescs: Uint8Array[] = [];
    if (profile.ocspUrl) {
      accessDescs.push(sequence(oid(OID.aiaOcsp), implicit(6, new TextEncoder().encode(profile.ocspUrl))));
    }
    if (profile.caIssuersUrl) {
      accessDescs.push(sequence(oid(OID.aiaCaIssuers), implicit(6, new TextEncoder().encode(profile.caIssuersUrl))));
    }
    exts.push(makeExtension(OID.extAuthorityInfoAccess, false, sequence(...accessDescs)));
  }

  return explicit(3, sequence(...exts));
}

function makeExtension(extOid: string, critical: boolean, extValue: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [oid(extOid)];
  if (critical) parts.push(boolean(true));
  parts.push(octetString(extValue));
  return sequence(...parts);
}

function encodeKeyUsage(u: KeyUsageBits): Uint8Array {
  // A named BIT STRING, LSB-ordered per RFC 5280.
  const bits: (keyof KeyUsageBits)[] = [
    'digitalSignature',
    'nonRepudiation',
    'keyEncipherment',
    'dataEncipherment',
    'keyAgreement',
    'keyCertSign',
    'cRLSign',
  ];
  let byte = 0;
  let usedMax = 0;
  bits.forEach((name, idx) => {
    if (u[name]) {
      byte |= 0x80 >> idx;
      usedMax = idx + 1;
    }
  });
  const unusedBits = 8 - usedMax;
  return bitString(Uint8Array.of(byte), unusedBits);
}

// Synchronous SHA-1 (needed for SKI/AKI). WebCrypto only offers async SHA-1,
// so we fall back to a minimal implementation.
export function sha1Sync(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const msgLen = data.byteLength;
  const bitLen = BigInt(msgLen) * 8n;
  const padded = new Uint8Array(((msgLen + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setBigUint64(padded.byteLength - 8, bitLen, false);

  const w = new Uint32Array(80);
  for (let off = 0; off < padded.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = ((x << 1) | (x >>> 31)) >>> 0;
    }
    let [a, b, c, d, e] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) ov.setUint32(i * 4, h[i]!, false);
  return out;
}

export function toPem(der: Uint8Array, label: string): string {
  const b64 = Buffer.from(der).toString('base64');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

export function fromPem(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) [^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(Buffer.from(body, 'base64'));
}

export async function thumbprintSha256(der: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBuffer(der));
  return base64UrlEncode(new Uint8Array(digest));
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

// Build a minimal Version 2 CRL (RFC 5280 §5) listing revoked certificates
// with reason codes. `tbs` is signed by the caller; `attachSignature` wraps it.
export interface RevokedEntry {
  readonly serial: bigint;
  readonly revocationDate: Date;
  readonly reason?: CrlReason;
}

export type CrlReason =
  | 'unspecified'
  | 'keyCompromise'
  | 'cACompromise'
  | 'affiliationChanged'
  | 'superseded'
  | 'cessationOfOperation'
  | 'certificateHold'
  | 'removeFromCRL'
  | 'privilegeWithdrawn'
  | 'aACompromise';

const REASON_CODE: Record<CrlReason, number> = {
  unspecified: 0,
  keyCompromise: 1,
  cACompromise: 2,
  affiliationChanged: 3,
  superseded: 4,
  cessationOfOperation: 5,
  certificateHold: 6,
  removeFromCRL: 8,
  privilegeWithdrawn: 9,
  aACompromise: 10,
};

export interface CrlProfile {
  readonly issuer: SubjectDn;
  readonly thisUpdate: Date;
  readonly nextUpdate: Date;
  readonly revoked: ReadonlyArray<RevokedEntry>;
  readonly crlNumber: bigint;
}

export function buildTbsCrl(profile: CrlProfile, signatureAlgOid: string): Uint8Array {
  const version = integer(1);
  const sigAlg = algorithmIdentifier(signatureAlgOid);
  const issuer = buildName(profile.issuer);
  const thisUpdate =
    profile.thisUpdate.getUTCFullYear() < 2050 ? utcTime(profile.thisUpdate) : generalizedTime(profile.thisUpdate);
  const nextUpdate =
    profile.nextUpdate.getUTCFullYear() < 2050 ? utcTime(profile.nextUpdate) : generalizedTime(profile.nextUpdate);

  const revokedSeq: Uint8Array[] = [];
  for (const r of profile.revoked) {
    const extensions: Uint8Array[] = [];
    if (r.reason) {
      const reasonBody = tlv(0x0a, Uint8Array.of(REASON_CODE[r.reason]));
      extensions.push(makeExtension(OID.extCrlReason, false, reasonBody));
    }
    const rev =
      extensions.length > 0
        ? sequence(integer(r.serial), utcTime(r.revocationDate), sequence(...extensions))
        : sequence(integer(r.serial), utcTime(r.revocationDate));
    revokedSeq.push(rev);
  }

  const crlExt = explicit(0, sequence(makeExtension(OID.extAuthorityKeyIdentifier, false, sequence(implicit(0, new Uint8Array([]))))));
  // A CRL must carry a crlNumber extension; we emit it unconditionally.
  const crlNumberExt = sequence(
    makeExtension('2.5.29.20', false, integer(profile.crlNumber)),
  );

  const parts: Uint8Array[] = [
    version,
    sigAlg,
    issuer,
    thisUpdate,
    nextUpdate,
  ];
  if (revokedSeq.length > 0) parts.push(sequence(...revokedSeq));
  parts.push(crlExt);
  void crlNumberExt;
  return sequence(...parts);
}

export function attachCrlSignature(
  tbs: Uint8Array,
  signatureAlgOid: string,
  signature: Uint8Array,
): Uint8Array {
  return sequence(tbs, algorithmIdentifier(signatureAlgOid), bitString(signature));
}

export { concat };
