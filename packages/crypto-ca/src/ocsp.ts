// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import {
  bitString,
  concat,
  explicit,
  generalizedTime,
  integer,
  nullValue,
  octetString,
  oid,
  parseTlv,
  sequence,
  TAG_INTEGER,
  TAG_OCTET_STRING,
  TAG_SEQUENCE,
} from './der.ts';
import { OID } from './oid.ts';
import type { CaSigner } from './acme/server.ts';
import type { CertificateRepository } from './acme/ports.ts';

// RFC 6960 OCSP responder. We implement the basic single-response BasicOCSPResponse
// with the "SHA-1" CertID variant most production clients use, and delegate the
// signing operation to the CA's CaSigner so the same HSM adapter serves both
// cert issuance and OCSP responses.

export type CertStatus =
  | { type: 'good' }
  | { type: 'revoked'; revocationTime: Date; reason?: number }
  | { type: 'unknown' };

export interface OcspRequest {
  readonly certSerialHex: string;
  readonly issuerNameHash: Uint8Array;
  readonly issuerKeyHash: Uint8Array;
}

export function parseOcspRequest(der: Uint8Array): OcspRequest | null {
  try {
    const outer = parseTlv(der);
    if (outer.tag !== TAG_SEQUENCE) return null;
    const tbs = parseTlv(outer.body, 0);
    if (tbs.tag !== TAG_SEQUENCE) return null;
    // tbs: [0] EXPLICIT Version DEFAULT v1(0), requestorName [1] EXPLICIT (optional),
    // requestList SEQUENCE OF Request, requestExtensions [2] EXPLICIT (optional)
    let off = 0;
    let firstEntry = parseTlv(tbs.body, off);
    while (firstEntry.tag !== TAG_SEQUENCE) {
      off += firstEntry.total.byteLength;
      if (off >= tbs.body.byteLength) return null;
      firstEntry = parseTlv(tbs.body, off);
    }
    // firstEntry is the requestList (SEQUENCE OF Request). Take the first Request.
    const requestList = firstEntry;
    const request = parseTlv(requestList.body, 0);
    if (request.tag !== TAG_SEQUENCE) return null;
    const certId = parseTlv(request.body, 0);
    if (certId.tag !== TAG_SEQUENCE) return null;
    // CertID ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier, issuerNameHash OCTET STRING,
    //                       issuerKeyHash OCTET STRING, serialNumber CertificateSerialNumber }
    const hashAlg = parseTlv(certId.body, 0);
    const issuerName = parseTlv(certId.body, hashAlg.total.byteLength);
    const issuerKey = parseTlv(
      certId.body,
      hashAlg.total.byteLength + issuerName.total.byteLength,
    );
    const serial = parseTlv(
      certId.body,
      hashAlg.total.byteLength + issuerName.total.byteLength + issuerKey.total.byteLength,
    );
    if (issuerName.tag !== TAG_OCTET_STRING) return null;
    if (issuerKey.tag !== TAG_OCTET_STRING) return null;
    if (serial.tag !== TAG_INTEGER) return null;
    let hex = '';
    for (const b of serial.body) hex += b.toString(16).padStart(2, '0');
    hex = hex.replace(/^0+/, '') || '0';
    return {
      certSerialHex: hex,
      issuerNameHash: issuerName.body,
      issuerKeyHash: issuerKey.body,
    };
  } catch {
    return null;
  }
}

export interface BuildResponseInput {
  readonly request: OcspRequest;
  readonly status: CertStatus;
  readonly thisUpdate: Date;
  readonly nextUpdate?: Date;
  readonly signer: CaSigner;
  readonly responderKeyHash: Uint8Array; // SHA-1 of CA public key bit-string
  readonly hashAlgOid: string; // typically SHA-1
}

// Build a DER-encoded OCSPResponse (responseStatus = successful, responseType =
// id-pkix-ocsp-basic, ResponseBytes = BasicOCSPResponse).
export async function buildOcspResponse(input: BuildResponseInput): Promise<Uint8Array> {
  // CertID (re-encoded from request)
  const certId = sequence(
    sequence(oid(input.hashAlgOid), nullValue()),
    octetString(input.request.issuerNameHash),
    octetString(input.request.issuerKeyHash),
    integer(BigInt('0x' + input.request.certSerialHex)),
  );

  const certStatusEncoded =
    input.status.type === 'good'
      ? tagged(0, new Uint8Array(0))
      : input.status.type === 'revoked'
        ? tagged(
            1,
            input.status.reason !== undefined
              ? concat(generalizedTime(input.status.revocationTime), explicit(0, integer(input.status.reason)))
              : generalizedTime(input.status.revocationTime),
          )
        : tagged(2, new Uint8Array(0));

  const singleResponse = sequence(
    certId,
    certStatusEncoded,
    generalizedTime(input.thisUpdate),
    ...(input.nextUpdate ? [explicit(0, generalizedTime(input.nextUpdate))] : []),
  );

  const responderId = explicit(
    2,
    octetString(input.responderKeyHash),
  );
  const producedAt = generalizedTime(input.thisUpdate);
  const tbsResponseData = sequence(
    responderId,
    producedAt,
    sequence(singleResponse),
  );

  const sigAlg = sequence(oid(input.signer.algorithmOid));
  const signature = await input.signer.sign(tbsResponseData);
  const basic = sequence(tbsResponseData, sigAlg, bitString(signature));

  const responseBytes = explicit(
    0,
    sequence(
      oid(OID.ocspBasic),
      octetString(basic),
    ),
  );

  const responseStatus = Uint8Array.of(0x0a, 0x01, 0x00); // ENUMERATED successful(0)
  return sequence(responseStatus, responseBytes);
}

function tagged(tagNumber: number, body: Uint8Array): Uint8Array {
  const tag = 0x80 | tagNumber;
  const len = encodeLength(body.byteLength);
  const out = new Uint8Array(1 + len.byteLength + body.byteLength);
  out[0] = tag;
  out.set(len, 1);
  out.set(body, 1 + len.byteLength);
  return out;
}

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  if (len < 0x100) return Uint8Array.of(0x81, len);
  if (len < 0x10000) return Uint8Array.of(0x82, (len >> 8) & 0xff, len & 0xff);
  return Uint8Array.of(
    0x83,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  );
}

// Wire the OCSP responder end-to-end: parse request, look up cert status,
// build and return the response. Used by the HTTP handler.
export class OcspResponder {
  constructor(
    private readonly certs: CertificateRepository,
    private readonly signer: CaSigner,
    private readonly responderKeyHash: Uint8Array,
  ) {}

  async respond(requestDer: Uint8Array): Promise<{ der: Uint8Array; contentType: string } | null> {
    const parsed = parseOcspRequest(requestDer);
    if (!parsed) return null;
    const cert = await this.certs.find(parsed.certSerialHex);
    const status: CertStatus = !cert
      ? { type: 'unknown' }
      : cert.revokedAt
        ? { type: 'revoked', revocationTime: new Date(cert.revokedAt) }
        : { type: 'good' };
    const der = await buildOcspResponse({
      request: parsed,
      status,
      thisUpdate: new Date(),
      signer: this.signer,
      responderKeyHash: this.responderKeyHash,
      hashAlgOid: OID.sha256,
    });
    return { der, contentType: 'application/ocsp-response' };
  }
}
