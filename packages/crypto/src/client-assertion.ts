// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Jwk, type Result } from '@bdi/kernel';
import { base64UrlDecode } from '@bdi/kernel';

export type AssertionError =
  | { type: 'malformed' }
  | { type: 'header-invalid' }
  | { type: 'unsupported-alg'; alg: string }
  | { type: 'payload-invalid' }
  | { type: 'bad-signature' }
  | { type: 'wrong-issuer'; expected: string; actual: string }
  | { type: 'wrong-subject'; expected: string; actual: string }
  | { type: 'wrong-audience'; expected: string; actual: string | string[] }
  | { type: 'expired' }
  | { type: 'not-yet-valid' }
  | { type: 'missing-jti' };

export interface AssertionClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  iat: number;
  exp: number;
  jti: string;
}

export interface VerifyOptions {
  readonly clientId: string;
  readonly expectedAudience: string;
  readonly now: number;
  readonly skewSeconds?: number;
}

// RFC 7523 §3: client authentication via a JWT bearer assertion. The client's
// JWK was registered at connector-creation time; this verifier reproduces the
// standard checks (alg, iss==sub==client_id, aud matches the token endpoint,
// exp/iat window with skew, jti present) and cryptographically verifies the
// signature against the registered public key.
export async function verifyClientAssertion(
  compact: string,
  jwk: Jwk,
  options: VerifyOptions,
): Promise<Result<AssertionClaims, AssertionError>> {
  const parts = compact.split('.');
  if (parts.length !== 3) return err({ type: 'malformed' });
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as { alg?: string };
  } catch {
    return err({ type: 'header-invalid' });
  }
  const alg = header.alg;
  if (!alg || !['ES256', 'ES384', 'EdDSA', 'PS256', 'RS256'].includes(alg)) {
    return err({ type: 'unsupported-alg', alg: alg ?? '' });
  }

  let claims: AssertionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as AssertionClaims;
  } catch {
    return err({ type: 'payload-invalid' });
  }

  const skew = options.skewSeconds ?? 30;
  if (claims.iss !== options.clientId) {
    return err({ type: 'wrong-issuer', expected: options.clientId, actual: claims.iss });
  }
  if (claims.sub !== options.clientId) {
    return err({ type: 'wrong-subject', expected: options.clientId, actual: claims.sub });
  }
  const audOk = typeof claims.aud === 'string'
    ? claims.aud === options.expectedAudience
    : Array.isArray(claims.aud) && claims.aud.includes(options.expectedAudience);
  if (!audOk) return err({ type: 'wrong-audience', expected: options.expectedAudience, actual: claims.aud });
  if (!Number.isInteger(claims.exp) || options.now > claims.exp + skew) return err({ type: 'expired' });
  if (!Number.isInteger(claims.iat) || options.now + skew < claims.iat) return err({ type: 'not-yet-valid' });
  if (!claims.jti || typeof claims.jti !== 'string') return err({ type: 'missing-jti' });

  const verified = await verifySignature(alg, jwk, `${headerB64}.${payloadB64}`, sigB64);
  if (!verified) return err({ type: 'bad-signature' });
  return ok(claims);
}

async function verifySignature(
  alg: string,
  jwk: Jwk,
  signingInput: string,
  sigB64: string,
): Promise<boolean> {
  const sig = base64UrlDecode(sigB64);
  const payload = new TextEncoder().encode(signingInput);
  const params = webCryptoParamsFor(alg);
  if (!params) return false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as unknown as JsonWebKey,
      params.importAlg,
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      params.verifyAlg,
      key,
      toBuffer(sig),
      toBuffer(payload),
    );
  } catch {
    return false;
  }
}

function webCryptoParamsFor(
  alg: string,
): { importAlg: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams; verifyAlg: AlgorithmIdentifier | EcdsaParams | RsaPssParams } | null {
  switch (alg) {
    case 'ES256':
      return {
        importAlg: { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyImportParams,
        verifyAlg: { name: 'ECDSA', hash: { name: 'SHA-256' } } as EcdsaParams,
      };
    case 'ES384':
      return {
        importAlg: { name: 'ECDSA', namedCurve: 'P-384' } as EcKeyImportParams,
        verifyAlg: { name: 'ECDSA', hash: { name: 'SHA-384' } } as EcdsaParams,
      };
    case 'EdDSA':
      return {
        importAlg: { name: 'Ed25519' } as AlgorithmIdentifier,
        verifyAlg: { name: 'Ed25519' } as AlgorithmIdentifier,
      };
    case 'PS256':
      return {
        importAlg: { name: 'RSA-PSS', hash: { name: 'SHA-256' } } as RsaHashedImportParams,
        verifyAlg: { name: 'RSA-PSS', saltLength: 32 } as RsaPssParams,
      };
    case 'RS256':
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
