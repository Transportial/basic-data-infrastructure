// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Jwk, type Result } from '@bdi/kernel';
import { base64UrlDecode } from '@bdi/kernel';
import { JwkSigner, type KeyAlg } from '@bdi/crypto';
import type { AuthnError, AuthnPort, Principal } from './authn.ts';

// OIDC access-token verifier used for Keycloak (and any other Authorization
// Server that speaks RFC 8414 discovery). The verifier caches the JWKS and
// its expiry, verifies the signature via WebCrypto, and validates iss/aud/
// exp/nbf and optional scope/role mapping.

export interface OidcDiscovery {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

export interface OidcVerifierOptions {
  readonly expectedIssuer: string;
  readonly expectedAudience: string | ReadonlyArray<string>;
  readonly fetcher?: typeof fetch;
  readonly clockSkewSeconds?: number;
  readonly roleClaim?: string;
  readonly nameClaim?: string;
  readonly emailClaim?: string;
  readonly acrToAssurance?: (acr: string) => 'substantial' | 'high' | undefined;
  readonly jwksCacheTtlMs?: number;
  readonly now?: () => number;
}

export class OidcAccessTokenVerifier implements AuthnPort {
  private keys: Map<string, Jwk> = new Map();
  private keysFetchedAt = 0;

  constructor(private readonly options: OidcVerifierOptions) {}

  async authenticate(bearer: string): Promise<Result<Principal, AuthnError>> {
    if (!bearer) return err({ type: 'missing-token' });
    const parts = bearer.split('.');
    if (parts.length !== 3) return err({ type: 'malformed-token' });
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as {
        alg?: string;
        kid?: string;
      };
    } catch {
      return err({ type: 'malformed-token' });
    }

    const keyAlg = mapAlg(header.alg);
    if (!keyAlg) return err({ type: 'bad-signature' });

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as Record<
        string,
        unknown
      >;
    } catch {
      return err({ type: 'malformed-token' });
    }

    const iss = typeof claims.iss === 'string' ? claims.iss : '';
    if (iss !== this.options.expectedIssuer) {
      return err({ type: 'wrong-issuer', expected: this.options.expectedIssuer, actual: iss });
    }

    const aud = claims.aud;
    if (!audienceMatches(aud, this.options.expectedAudience)) {
      return err({
        type: 'wrong-audience',
        expected: String(this.options.expectedAudience),
        actual: Array.isArray(aud) ? (aud as string[]) : typeof aud === 'string' ? aud : '',
      });
    }

    const now = Math.floor((this.options.now ?? Date.now)() / 1000);
    const skew = this.options.clockSkewSeconds ?? 30;
    if (typeof claims.exp === 'number' && now > claims.exp + skew) {
      return err({ type: 'expired' });
    }
    if (typeof claims.nbf === 'number' && now + skew < claims.nbf) {
      return err({ type: 'expired' });
    }

    const jwk = await this.resolveKey(header.kid);
    if (!jwk) return err({ type: 'bad-signature' });

    const verified = await verifySignature(
      keyAlg,
      jwk,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      base64UrlDecode(sigB64),
    );
    if (!verified) return err({ type: 'bad-signature' });

    const roleClaim = this.options.roleClaim ?? 'realm_access.roles';
    const roles = extractRoles(claims, roleClaim);
    const name = this.options.nameClaim
      ? pickString(claims, this.options.nameClaim) ?? pickString(claims, 'name')
      : pickString(claims, 'name');
    const email = this.options.emailClaim
      ? pickString(claims, this.options.emailClaim) ?? pickString(claims, 'email')
      : pickString(claims, 'email');
    const acr = pickString(claims, 'acr');
    const assurance = acr ? this.options.acrToAssurance?.(acr) : undefined;

    const principal: Principal = {
      subject: String(claims.sub ?? ''),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      roles,
      ...(assurance !== undefined ? { assurance } : {}),
      idp: iss,
      raw: claims,
    };
    return ok(principal);
  }

  private async resolveKey(kid: string | undefined): Promise<Jwk | null> {
    const cacheTtl = this.options.jwksCacheTtlMs ?? 10 * 60_000;
    const now = (this.options.now ?? Date.now)();
    if (this.keys.size === 0 || now - this.keysFetchedAt > cacheTtl) {
      await this.fetchJwks();
      this.keysFetchedAt = now;
    }
    if (!kid) {
      // With no kid we can only succeed if the JWKS has exactly one key.
      if (this.keys.size === 1) return [...this.keys.values()][0] ?? null;
      return null;
    }
    return this.keys.get(kid) ?? null;
  }

  private async fetchJwks(): Promise<void> {
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    // RFC 8414 discovery
    const wellKnown = `${this.options.expectedIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discoRes = await fetcher(wellKnown);
    if (!discoRes.ok) throw new Error(`oidc discovery ${discoRes.status}`);
    const disco = (await discoRes.json()) as OidcDiscovery;
    const jwksRes = await fetcher(disco.jwks_uri);
    if (!jwksRes.ok) throw new Error(`oidc jwks ${jwksRes.status}`);
    const jwks = (await jwksRes.json()) as { keys: Array<Jwk & { kid?: string }> };
    this.keys = new Map();
    for (const k of jwks.keys) {
      if (k.kid) this.keys.set(k.kid, k);
    }
  }
}

function audienceMatches(
  aud: unknown,
  expected: string | ReadonlyArray<string>,
): boolean {
  const wanted = Array.isArray(expected) ? expected : [expected];
  if (typeof aud === 'string') return wanted.includes(aud);
  if (Array.isArray(aud)) return aud.some((a) => typeof a === 'string' && wanted.includes(a));
  return false;
}

function pickString(claims: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = claims;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function extractRoles(claims: Record<string, unknown>, path: string): string[] {
  const parts = path.split('.');
  let cur: unknown = claims;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return [];
    }
  }
  return Array.isArray(cur) ? cur.filter((r): r is string => typeof r === 'string') : [];
}

function mapAlg(alg: string | undefined): KeyAlg | null {
  switch (alg) {
    case 'ES256':
      return 'ES256';
    case 'ES384':
      return 'ES384';
    case 'EdDSA':
      return 'EdDSA';
    case 'PS256':
      return 'PS256';
    default:
      return null;
  }
}

async function verifySignature(
  alg: KeyAlg,
  jwk: Jwk,
  signingInput: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const signer = new JwkSigner(jwk, alg);
  try {
    return await signer.verify(signingInput, signature);
  } catch {
    return false;
  }
}
