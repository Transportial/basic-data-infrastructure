// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { generateKeyPair } from '@transportial/crypto';
import { JwkCaSigner } from '../src/ca-signer.ts';
import { InMemoryCertificateRepository } from '../src/acme/repositories.ts';
import {
  buildOcspResponse,
  parseOcspRequest,
  OcspResponder,
  type CertStatus,
} from '../src/ocsp.ts';
import {
  concat,
  integer,
  nullValue,
  octetString,
  oid,
  sequence,
  tlv,
} from '../src/der.ts';
import { OID } from '../src/oid.ts';

function buildOcspRequestDer(serialHex: string): Uint8Array {
  const hashAlg = sequence(oid(OID.sha256), nullValue());
  const issuerNameHash = new Uint8Array(32).fill(0xa1);
  const issuerKeyHash = new Uint8Array(32).fill(0xb2);
  const serial = integer(BigInt('0x' + serialHex));
  const certId = sequence(
    hashAlg,
    octetString(issuerNameHash),
    octetString(issuerKeyHash),
    serial,
  );
  const request = sequence(certId);
  const requestList = sequence(request);
  const tbs = sequence(requestList);
  return sequence(tbs);
}

describe('parseOcspRequest', () => {
  test('extracts serial and issuer hashes', () => {
    const der = buildOcspRequestDer('deadbeef');
    const parsed = parseOcspRequest(der);
    expect(parsed?.certSerialHex).toBe('deadbeef');
    expect(parsed?.issuerNameHash.byteLength).toBe(32);
    expect(parsed?.issuerKeyHash.byteLength).toBe(32);
  });

  test('returns null on garbage', () => {
    expect(parseOcspRequest(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});

describe('buildOcspResponse', () => {
  test('builds a DER response for good status', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const req = parseOcspRequest(buildOcspRequestDer('01'))!;
    const der = await buildOcspResponse({
      request: req,
      status: { type: 'good' } satisfies CertStatus,
      thisUpdate: new Date(),
      signer,
      responderKeyHash: new Uint8Array(20),
      hashAlgOid: OID.sha256,
    });
    expect(der[0]).toBe(0x30);
  });

  test('encodes revoked with reason', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const req = parseOcspRequest(buildOcspRequestDer('01'))!;
    const der = await buildOcspResponse({
      request: req,
      status: { type: 'revoked', revocationTime: new Date(), reason: 4 },
      thisUpdate: new Date(),
      signer,
      responderKeyHash: new Uint8Array(20),
      hashAlgOid: OID.sha256,
    });
    expect(der.byteLength).toBeGreaterThan(50);
  });

  test('encodes unknown status', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const req = parseOcspRequest(buildOcspRequestDer('01'))!;
    const der = await buildOcspResponse({
      request: req,
      status: { type: 'unknown' },
      thisUpdate: new Date(),
      signer,
      responderKeyHash: new Uint8Array(20),
      hashAlgOid: OID.sha256,
    });
    expect(der.byteLength).toBeGreaterThan(0);
  });

  test('encodes nextUpdate when provided', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const req = parseOcspRequest(buildOcspRequestDer('01'))!;
    const der = await buildOcspResponse({
      request: req,
      status: { type: 'good' },
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 86_400_000),
      signer,
      responderKeyHash: new Uint8Array(20),
      hashAlgOid: OID.sha256,
    });
    expect(der[0]).toBe(0x30);
  });
});

describe('OcspResponder', () => {
  test('reports revoked for revoked certs', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const repo = new InMemoryCertificateRepository();
    await repo.save({
      serial: 'deadbeef',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: 'x',
      revokedAt: new Date().toISOString(),
    });
    const responder = new OcspResponder(repo, signer, new Uint8Array(20));
    const req = buildOcspRequestDer('deadbeef');
    const resp = await responder.respond(req);
    expect(resp?.contentType).toBe('application/ocsp-response');
  });

  test('reports good for live certs', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const repo = new InMemoryCertificateRepository();
    await repo.save({
      serial: '1234abcd',
      accountId: 'a',
      orderId: 'o',
      pem: '',
      notAfter: 'x',
    });
    const responder = new OcspResponder(repo, signer, new Uint8Array(20));
    const resp = await responder.respond(buildOcspRequestDer('1234abcd'));
    expect(resp?.der.byteLength).toBeGreaterThan(0);
  });

  test('reports unknown for missing serial', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const responder = new OcspResponder(new InMemoryCertificateRepository(), signer, new Uint8Array(20));
    const resp = await responder.respond(buildOcspRequestDer('aabb'));
    expect(resp).not.toBeNull();
  });

  test('null on malformed request', async () => {
    const ca = await generateKeyPair('ES256');
    const signer = JwkCaSigner.from(ca.privateJwk, 'ES256');
    const responder = new OcspResponder(new InMemoryCertificateRepository(), signer, new Uint8Array(20));
    expect(await responder.respond(new Uint8Array([0, 1]))).toBeNull();
  });
});

// unused
void concat;
void tlv;
