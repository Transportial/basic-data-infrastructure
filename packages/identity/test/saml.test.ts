// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  SamlBroker,
  RegexpSamlXmlParser,
  AcceptAllSignatureVerifier,
  RejectAllSignatureVerifier,
} from '../src/saml.ts';

function makeAssertion(opts: {
  issuer?: string;
  nameId?: string;
  notBefore?: string;
  notOnOrAfter?: string;
  audience?: string;
  attributes?: Record<string, string[]>;
  acClassRef?: string;
}): string {
  const issuer = opts.issuer ?? 'https://eh.example/idp';
  const nameId = opts.nameId ?? 'subject-001';
  const notBefore = opts.notBefore ?? '2026-01-01T00:00:00Z';
  const notOnOrAfter = opts.notOnOrAfter ?? '2030-01-01T00:00:00Z';
  const audience = opts.audience ?? 'urn:bdi:asr';
  const attrs = opts.attributes ?? {};
  const attributesXml = Object.entries(attrs)
    .map(([name, vals]) => {
      const values = vals
        .map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`)
        .join('');
      return `<saml:Attribute Name="${name}">${values}</saml:Attribute>`;
    })
    .join('');
  const acrXml = opts.acClassRef
    ? `<saml:AuthnStatement><saml:AuthnContext><saml:AuthnContextClassRef>${opts.acClassRef}</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    : '';
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
    <saml:Issuer>${issuer}</saml:Issuer>
    <saml:Subject><saml:NameID>${nameId}</saml:NameID></saml:Subject>
    <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
      <saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    ${acrXml}
    <saml:AttributeStatement>${attributesXml}</saml:AttributeStatement>
  </saml:Assertion>`;
}

describe('RegexpSamlXmlParser', () => {
  const parser = new RegexpSamlXmlParser();

  test('extracts issuer, subject, conditions, audience', () => {
    const xml = makeAssertion({ issuer: 'https://idp.example/x', nameId: 'sub-1' });
    const a = parser.parse(xml);
    expect(a).not.toBeNull();
    expect(a?.issuer).toBe('https://idp.example/x');
    expect(a?.subjectNameId).toBe('sub-1');
    expect(a?.audiences).toContain('urn:bdi:asr');
    expect(a?.notBefore).toBe('2026-01-01T00:00:00Z');
  });

  test('extracts attributes with multiple values', () => {
    const xml = makeAssertion({
      attributes: {
        'urn:nl:eherkenning:LoA': ['urn:etoegang:LoA3'],
        'urn:oid:2.5.4.15': ['role1', 'role2'],
      },
    });
    const a = parser.parse(xml);
    expect(a?.attributes.get('urn:nl:eherkenning:LoA')).toEqual(['urn:etoegang:LoA3']);
    expect(a?.attributes.get('urn:oid:2.5.4.15')).toEqual(['role1', 'role2']);
  });

  test('extracts AuthnContextClassRef', () => {
    const xml = makeAssertion({ acClassRef: 'urn:etoegang:LoA3' });
    const a = parser.parse(xml);
    expect(a?.acClassRef).toBe('urn:etoegang:LoA3');
  });

  test('returns null for malformed assertion', () => {
    expect(parser.parse('not xml')).toBeNull();
    expect(parser.parse('<foo></foo>')).toBeNull();
  });
});

describe('SamlBroker', () => {
  const parser = new RegexpSamlXmlParser();
  const base = {
    trustedIssuers: ['https://eh.example/idp'],
    expectedAudience: 'urn:bdi:asr',
    parser,
    signatureVerifier: new AcceptAllSignatureVerifier(),
  } as const;

  test('returns principal on valid assertion', async () => {
    const broker = new SamlBroker({
      ...base,
      acClassRefToAssurance: (acr) => (acr.includes('LoA3') ? 'substantial' : undefined),
    });
    const xml = makeAssertion({
      attributes: {
        'urn:oid:2.5.4.42': ['Alice Admin'],
        'urn:oid:0.9.2342.19200300.100.1.3': ['alice@example.org'],
        'urn:oid:2.5.4.15': ['asr-admin'],
      },
      acClassRef: 'urn:etoegang:LoA3',
    });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subject).toBe('subject-001');
      expect(r.value.name).toBe('Alice Admin');
      expect(r.value.email).toBe('alice@example.org');
      expect(r.value.roles).toContain('asr-admin');
      expect(r.value.assurance).toBe('substantial');
      expect(r.value.idp).toBe('https://eh.example/idp');
    }
  });

  test('rejects missing token', async () => {
    const broker = new SamlBroker(base);
    const r = await broker.authenticate('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('missing-token');
  });

  test('rejects malformed token', async () => {
    const broker = new SamlBroker(base);
    const r = await broker.authenticate('not xml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('malformed-token');
  });

  test('rejects unknown idp', async () => {
    const broker = new SamlBroker(base);
    const xml = makeAssertion({ issuer: 'https://evil.example/idp' });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('unknown-idp');
  });

  test('rejects wrong audience', async () => {
    const broker = new SamlBroker(base);
    const xml = makeAssertion({ audience: 'urn:other' });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('wrong-audience');
  });

  test('rejects expired assertion', async () => {
    const broker = new SamlBroker({ ...base, clockSkewSeconds: 0 });
    const xml = makeAssertion({
      notBefore: '2020-01-01T00:00:00Z',
      notOnOrAfter: '2020-01-02T00:00:00Z',
    });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('expired');
  });

  test('rejects not-yet-valid assertion', async () => {
    const broker = new SamlBroker({ ...base, clockSkewSeconds: 0 });
    const xml = makeAssertion({
      notBefore: '2099-01-01T00:00:00Z',
      notOnOrAfter: '2099-12-31T00:00:00Z',
    });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('expired');
  });

  test('rejects bad signature', async () => {
    const broker = new SamlBroker({ ...base, signatureVerifier: new RejectAllSignatureVerifier() });
    const xml = makeAssertion({});
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('bad-signature');
  });

  test('respects custom attribute mappings', async () => {
    const broker = new SamlBroker({
      ...base,
      nameAttribute: 'custom:name',
      emailAttribute: 'custom:email',
      rolesAttribute: 'custom:roles',
    });
    const xml = makeAssertion({
      attributes: {
        'custom:name': ['Bob'],
        'custom:email': ['bob@example.org'],
        'custom:roles': ['viewer', 'editor'],
      },
    });
    const r = await broker.authenticate(xml);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Bob');
      expect(r.value.email).toBe('bob@example.org');
      expect(r.value.roles).toEqual(['viewer', 'editor']);
    }
  });
});
