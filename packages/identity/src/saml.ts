// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@bdi/kernel';
import type { AuthnError, Principal } from './authn.ts';

// Minimal SAML 2.0 assertion validator sufficient for eHerkenning /
// eIDAS tokens. Production operators typically prefer to run SAML in
// Keycloak and consume the resulting OIDC token — this adapter exists for
// direct SAML consumers and handles:
// - XML assertion parsing via a narrow XML port (no heavy XML lib required)
// - NotBefore/NotOnOrAfter window check
// - Audience restriction check
// - Issuer check against the trusted list
// - Attribute extraction (eHerkenning ServiceID, LoA, pseudonym)
// The signature is verified via an external SignatureVerifier port so
// operators plug in xml-crypto or equivalent.

export interface SamlAssertion {
  readonly issuer: string;
  readonly subjectNameId: string;
  readonly audiences: ReadonlyArray<string>;
  readonly notBefore: string;
  readonly notOnOrAfter: string;
  readonly attributes: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly acClassRef?: string;
}

export interface SamlXmlParser {
  parse(xml: string): SamlAssertion | null;
}

export interface SamlSignatureVerifier {
  verify(xml: string, trustedIssuer: string): Promise<boolean>;
}

export interface SamlBrokerOptions {
  readonly trustedIssuers: ReadonlyArray<string>;
  readonly expectedAudience: string;
  readonly parser: SamlXmlParser;
  readonly signatureVerifier: SamlSignatureVerifier;
  readonly clockSkewSeconds?: number;
  readonly now?: () => number;
  readonly acClassRefToAssurance?: (acr: string) => 'substantial' | 'high' | undefined;
  readonly nameAttribute?: string;
  readonly emailAttribute?: string;
  readonly rolesAttribute?: string;
}

export class SamlBroker {
  constructor(private readonly options: SamlBrokerOptions) {}

  async authenticate(assertionXml: string): Promise<Result<Principal, AuthnError>> {
    if (!assertionXml) return err({ type: 'missing-token' });
    const parsed = this.options.parser.parse(assertionXml);
    if (!parsed) return err({ type: 'malformed-token' });

    if (!this.options.trustedIssuers.includes(parsed.issuer)) {
      return err({ type: 'unknown-idp', iss: parsed.issuer });
    }

    if (!parsed.audiences.includes(this.options.expectedAudience)) {
      return err({
        type: 'wrong-audience',
        expected: this.options.expectedAudience,
        actual: parsed.audiences,
      });
    }

    const now = (this.options.now ?? Date.now)();
    const skew = (this.options.clockSkewSeconds ?? 30) * 1000;
    const notBefore = new Date(parsed.notBefore).getTime();
    const notOnOrAfter = new Date(parsed.notOnOrAfter).getTime();
    if (now + skew < notBefore) return err({ type: 'expired' });
    if (now - skew >= notOnOrAfter) return err({ type: 'expired' });

    const sigOk = await this.options.signatureVerifier.verify(assertionXml, parsed.issuer);
    if (!sigOk) return err({ type: 'bad-signature' });

    const attrs = parsed.attributes;
    const name = this.options.nameAttribute
      ? attrs.get(this.options.nameAttribute)?.[0]
      : attrs.get('urn:oid:2.5.4.42')?.[0] ?? attrs.get('displayName')?.[0];
    const email = this.options.emailAttribute
      ? attrs.get(this.options.emailAttribute)?.[0]
      : attrs.get('urn:oid:0.9.2342.19200300.100.1.3')?.[0];
    const roles = this.options.rolesAttribute
      ? attrs.get(this.options.rolesAttribute) ?? []
      : attrs.get('urn:oid:2.5.4.15') ?? [];
    const assurance = parsed.acClassRef
      ? this.options.acClassRefToAssurance?.(parsed.acClassRef)
      : undefined;

    const principal: Principal = {
      subject: parsed.subjectNameId,
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      roles: [...roles],
      ...(assurance !== undefined ? { assurance } : {}),
      idp: parsed.issuer,
    };
    return ok(principal);
  }
}

// Minimal XML parser for SAML assertions — finds the top-level <saml:Assertion>,
// <saml:Issuer>, <saml:Subject>/<saml:NameID>, <saml:Conditions> (NotBefore,
// NotOnOrAfter, AudienceRestriction/Audience), <saml:AuthnStatement>/
// <saml:AuthnContext>/<saml:AuthnContextClassRef>, and <saml:AttributeStatement>
// with <saml:Attribute Name="..."><saml:AttributeValue>..</saml:AttributeValue></saml:Attribute>.
// Good enough to extract eHerkenning fields without pulling in an XML library;
// operators integrating with full‐fidelity SAML should plug in their own parser.
export class RegexpSamlXmlParser implements SamlXmlParser {
  parse(xml: string): SamlAssertion | null {
    try {
      const issuer = extractText(xml, /<(?:saml:)?Issuer[^>]*>([^<]+)<\/(?:saml:)?Issuer>/);
      const subjectNameId = extractText(xml, /<(?:saml:)?NameID[^>]*>([^<]+)<\/(?:saml:)?NameID>/);
      const notBefore = extractAttribute(xml, /<(?:saml:)?Conditions[^>]*\sNotBefore="([^"]+)"/);
      const notOnOrAfter = extractAttribute(
        xml,
        /<(?:saml:)?Conditions[^>]*\sNotOnOrAfter="([^"]+)"/,
      );
      const audiences: string[] = [];
      for (const m of xml.matchAll(/<(?:saml:)?Audience[^>]*>([^<]+)<\/(?:saml:)?Audience>/g)) {
        audiences.push(m[1]!);
      }
      const acClassRef = extractText(
        xml,
        /<(?:saml:)?AuthnContextClassRef[^>]*>([^<]+)<\/(?:saml:)?AuthnContextClassRef>/,
      );

      const attributes = new Map<string, string[]>();
      const attrRegex =
        /<(?:saml:)?Attribute(?:\s[^>]*)?\sName="([^"]+)"[^>]*>([\s\S]*?)<\/(?:saml:)?Attribute>/g;
      for (const match of xml.matchAll(attrRegex)) {
        const name = match[1]!;
        const body = match[2]!;
        const values: string[] = [];
        for (const v of body.matchAll(
          /<(?:saml:)?AttributeValue[^>]*>([\s\S]*?)<\/(?:saml:)?AttributeValue>/g,
        )) {
          values.push(v[1]!.trim());
        }
        attributes.set(name, values);
      }

      if (!issuer || !subjectNameId || !notBefore || !notOnOrAfter) return null;
      return {
        issuer,
        subjectNameId,
        audiences,
        notBefore,
        notOnOrAfter,
        attributes: attributes as ReadonlyMap<string, ReadonlyArray<string>>,
        ...(acClassRef ? { acClassRef } : {}),
      };
    } catch {
      return null;
    }
  }
}

function extractText(xml: string, regex: RegExp): string | null {
  const m = regex.exec(xml);
  return m?.[1] ?? null;
}

function extractAttribute(xml: string, regex: RegExp): string | null {
  const m = regex.exec(xml);
  return m?.[1] ?? null;
}

// Null-op verifier used in tests: every signature passes. Production operators
// plug in an XML-DSig verifier.
export class AcceptAllSignatureVerifier implements SamlSignatureVerifier {
  async verify(_xml: string, _trustedIssuer: string): Promise<boolean> {
    return true;
  }
}

export class RejectAllSignatureVerifier implements SamlSignatureVerifier {
  async verify(): Promise<boolean> {
    return false;
  }
}
