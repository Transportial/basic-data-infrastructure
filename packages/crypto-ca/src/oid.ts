// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Registry of OIDs used for X.509 / PKCS#10 / PKIX extensions. Keeping them
// named rather than inlined makes the ASN.1 build sites readable and lets
// auditors spot unknown OIDs immediately.

export const OID = {
  // Algorithm identifiers
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSAEncryption: '1.2.840.113549.1.1.11',
  rsaPss: '1.2.840.113549.1.1.10',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  ecdsaWithSha384: '1.2.840.10045.4.3.3',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  ed25519: '1.3.101.112',

  // Hash algorithms
  sha256: '2.16.840.1.101.3.4.2.1',

  // PKCS#9
  extensionRequest: '1.2.840.113549.1.9.14',

  // Distinguished Name attributes
  commonName: '2.5.4.3',
  organizationName: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  country: '2.5.4.6',
  locality: '2.5.4.7',
  stateOrProvince: '2.5.4.8',
  organizationIdentifier: '2.5.4.97', // ETSI EN 319 412-1

  // X.509 v3 extensions (PKIX)
  extSubjectKeyIdentifier: '2.5.29.14',
  extKeyUsage: '2.5.29.15',
  extSubjectAltName: '2.5.29.17',
  extBasicConstraints: '2.5.29.19',
  extCrlDistributionPoints: '2.5.29.31',
  extCertificatePolicies: '2.5.29.32',
  extAuthorityKeyIdentifier: '2.5.29.35',
  extExtendedKeyUsage: '2.5.29.37',
  extCrlReason: '2.5.29.21',

  // Extended Key Usage values
  ekuServerAuth: '1.3.6.1.5.5.7.3.1',
  ekuClientAuth: '1.3.6.1.5.5.7.3.2',
  ekuOcspSigning: '1.3.6.1.5.5.7.3.9',

  // Authority Information Access
  extAuthorityInfoAccess: '1.3.6.1.5.5.7.1.1',
  aiaOcsp: '1.3.6.1.5.5.7.48.1',
  aiaCaIssuers: '1.3.6.1.5.5.7.48.2',

  // OCSP
  ocspBasic: '1.3.6.1.5.5.7.48.1.1',
  ocspNonce: '1.3.6.1.5.5.7.48.1.2',
} as const;
