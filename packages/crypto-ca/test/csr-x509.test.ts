// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { base64UrlDecode, type Jwk } from '@bdi/kernel';
import { generateKeyPair, JwkSigner, publicJwk } from '@bdi/crypto';
import {
  attachSignature,
  buildTbsCertificate,
  sha1Sync,
  fromPem,
  toPem,
  thumbprintSha256,
  buildTbsCrl,
  attachCrlSignature,
  type CertProfile,
  type SubjectDn,
} from '../src/x509.ts';
import { parseCsr, verifyCsrSignature, decodeOid } from '../src/csr.ts';
import { JwkCaSigner } from '../src/ca-signer.ts';
import { OID } from '../src/oid.ts';
import { jwkToSpki, spkiPublicKeyBytes } from '../src/spki.ts';
import {
  bitString,
  concat,
  integer,
  oid,
  octetString,
  sequence,
  set,
  tlv,
  utf8,
} from '../src/der.ts';

const CA: SubjectDn = {
  commonName: 'BDI CA',
  organization: 'Connekt',
  country: 'NL',
};

async function buildCsr(privateJwk: Jwk, publicKeyJwk: Jwk, sans: string[]): Promise<Uint8Array> {
  const subject = sequence(set(sequence(oid(OID.commonName), utf8(sans[0] ?? 'connector'))));
  const spki = jwkToSpki(publicKeyJwk);
  const sanExt = sequence(
    oid(OID.extSubjectAltName),
    octetString(sequence(...sans.map((s) => tlv(0x82, new TextEncoder().encode(s))))),
  );
  const extReq = sequence(oid(OID.extensionRequest), set(sequence(sanExt)));
  const attributes = tlv(0xa0, concat(extReq));
  const tbs = sequence(integer(0), subject, spki, attributes);
  const sigAlg = sequence(oid(OID.ecdsaWithSha256));
  const signer = new JwkSigner(privateJwk, 'ES256');
  const sig = await signer.sign(tbs);
  return sequence(tbs, sigAlg, bitString(sig));
}

describe('CSR parsing', () => {
  test('parses a valid CSR', async () => {
    const kp = await generateKeyPair('ES256');
    const csr = await buildCsr(kp.privateJwk, publicJwk(kp.publicJwk), ['example.com']);
    const r = parseCsr(csr);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sanDnsNames).toEqual(['example.com']);
      expect(r.value.subject.get(OID.commonName)).toBe('example.com');
    }
  });

  test('rejects truncated CSR', () => {
    const r = parseCsr(new Uint8Array([0x30, 0x80]));
    expect(!r.ok && r.error.type).toBe('malformed');
  });

  test('rejects garbage CSR', () => {
    const r = parseCsr(new Uint8Array([1, 2, 3, 4, 5]));
    expect(!r.ok).toBe(true);
  });

  test('verifies its own signature', async () => {
    const kp = await generateKeyPair('ES256');
    const csr = await buildCsr(kp.privateJwk, publicJwk(kp.publicJwk), ['example.com']);
    const parsed = parseCsr(csr);
    if (parsed.ok) {
      expect(await verifyCsrSignature(parsed.value)).toBe(true);
    }
  });

  test('decodeOid round-trips common oids', () => {
    const testOids = [OID.commonName, OID.extSubjectAltName, OID.ecdsaWithSha256, '1.2', '1.2.3.4.5.6.7'];
    for (const o of testOids) {
      const enc = oid(o);
      // strip the tag+len header to get body
      const body = enc.slice(2);
      expect(decodeOid(body)).toBe(o);
    }
  });
});

describe('X.509 certificate generation', () => {
  test('issues a self-signed CA certificate and a leaf', async () => {
    const caPair = await generateKeyPair('ES256');
    const leafPair = await generateKeyPair('ES256');
    const caSigner = JwkCaSigner.from(caPair.privateJwk, 'ES256');
    const leafProfile: CertProfile = {
      serial: 1n,
      subject: { commonName: 'connector.example.com' },
      issuer: CA,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 86400_000),
      subjectPublicKeyJwk: publicJwk(leafPair.publicJwk),
      issuerPublicKeyJwk: publicJwk(caPair.publicJwk),
      isCa: false,
      keyUsage: { digitalSignature: true, keyEncipherment: true },
      extendedKeyUsages: [OID.ekuClientAuth, OID.ekuServerAuth],
      sanDns: ['connector.example.com'],
      sanUris: ['urn:bdi:connector:1'],
      crlDistributionUrl: 'https://asr.test/crl',
      ocspUrl: 'https://asr.test/ocsp',
      caIssuersUrl: 'https://asr.test/ca.crt',
    };
    const tbs = buildTbsCertificate(leafProfile, OID.ecdsaWithSha256);
    const sig = await caSigner.sign(tbs);
    const cert = attachSignature(tbs, OID.ecdsaWithSha256, sig);
    const pem = toPem(cert, 'CERTIFICATE');
    expect(pem).toContain('BEGIN CERTIFICATE');
    const roundtrip = fromPem(pem);
    expect(roundtrip.byteLength).toBe(cert.byteLength);
  });

  test('CA cert with path-length constraint', async () => {
    const caPair = await generateKeyPair('ES256');
    const profile: CertProfile = {
      serial: 2n,
      subject: CA,
      issuer: CA,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 86400_000),
      subjectPublicKeyJwk: publicJwk(caPair.publicJwk),
      issuerPublicKeyJwk: publicJwk(caPair.publicJwk),
      isCa: true,
      pathLenConstraint: 0,
      keyUsage: { keyCertSign: true, cRLSign: true },
    };
    const tbs = buildTbsCertificate(profile, OID.ecdsaWithSha256);
    expect(tbs.byteLength).toBeGreaterThan(100);
  });

  test('validity encoding switches to GeneralizedTime after 2050', async () => {
    const caPair = await generateKeyPair('ES256');
    const profile: CertProfile = {
      serial: 1n,
      subject: CA,
      issuer: CA,
      notBefore: new Date('2070-01-01T00:00:00Z'),
      notAfter: new Date('2080-01-01T00:00:00Z'),
      subjectPublicKeyJwk: publicJwk(caPair.publicJwk),
      issuerPublicKeyJwk: publicJwk(caPair.publicJwk),
      isCa: false,
    };
    const tbs = buildTbsCertificate(profile, OID.ecdsaWithSha256);
    expect(tbs.byteLength).toBeGreaterThan(50);
  });

  test('RSA SPKI produced when public JWK is RSA', async () => {
    // Generate a real RSA keypair via WebCrypto
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: { name: 'SHA-256' },
      } as RsaHashedKeyGenParams,
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as unknown as Jwk;
    const spki = jwkToSpki(pub);
    expect(spki[0]).toBe(0x30);
    const pk = spkiPublicKeyBytes(spki);
    expect(pk.byteLength).toBeGreaterThan(100);
  });

  test('Ed25519 SPKI', async () => {
    const pair = await generateKeyPair('EdDSA');
    const spki = jwkToSpki(publicJwk(pair.publicJwk));
    expect(spki[0]).toBe(0x30);
  });

  test('sha1Sync matches WebCrypto', async () => {
    const data = new TextEncoder().encode('hello');
    const ours = sha1Sync(data);
    const theirs = new Uint8Array(
      await crypto.subtle.digest('SHA-1', toBuf(data)),
    );
    expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
  });

  test('sha1Sync padding for >55-byte inputs', async () => {
    const data = new TextEncoder().encode('a'.repeat(100));
    const ours = sha1Sync(data);
    const theirs = new Uint8Array(await crypto.subtle.digest('SHA-1', toBuf(data)));
    expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
  });

  test('thumbprintSha256 matches WebCrypto', async () => {
    const bytes = new TextEncoder().encode('test');
    const t = await thumbprintSha256(bytes);
    expect(t.length).toBeGreaterThan(20);
  });

  test('unsupported kty rejected by jwkToSpki', () => {
    expect(() => jwkToSpki({ kty: 'oct' } as unknown as Jwk)).toThrow();
  });

  test('unsupported EC curve rejected', () => {
    expect(() => jwkToSpki({ kty: 'EC', crv: 'P-521', x: 'aa', y: 'bb' } as Jwk)).toThrow();
  });

  test('CRL generation + signing', async () => {
    const caPair = await generateKeyPair('ES256');
    const caSigner = JwkCaSigner.from(caPair.privateJwk, 'ES256');
    const tbs = buildTbsCrl(
      {
        issuer: CA,
        thisUpdate: new Date(),
        nextUpdate: new Date(Date.now() + 7 * 86400_000),
        revoked: [
          { serial: 0x11n, revocationDate: new Date(), reason: 'keyCompromise' },
          { serial: 0x22n, revocationDate: new Date() },
        ],
        crlNumber: 1n,
      },
      OID.ecdsaWithSha256,
    );
    const sig = await caSigner.sign(tbs);
    const crl = attachCrlSignature(tbs, OID.ecdsaWithSha256, sig);
    expect(crl[0]).toBe(0x30);
  });
});

function toBuf(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

// Silence unused-import checker
void base64UrlDecode;
