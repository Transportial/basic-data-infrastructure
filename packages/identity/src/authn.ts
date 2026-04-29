// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@bdi/kernel';

// Narrow authentication port used by the ASR admin API and the portals.
// Implementations: OidcAccessTokenVerifier (Keycloak/Entra/Okta), SamlAssertionVerifier
// (eHerkenning / eIDAS via Keycloak broker), static BearerVerifier (tests).

export interface Principal {
  readonly subject: string;
  readonly name?: string;
  readonly email?: string;
  readonly roles: ReadonlyArray<string>;
  readonly assurance?: 'substantial' | 'high';
  readonly idp?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export type AuthnError =
  | { type: 'missing-token' }
  | { type: 'malformed-token' }
  | { type: 'expired' }
  | { type: 'wrong-issuer'; expected: string; actual: string }
  | { type: 'wrong-audience'; expected: string; actual: string | ReadonlyArray<string> }
  | { type: 'bad-signature' }
  | { type: 'unknown-idp'; iss: string };

export interface AuthnPort {
  authenticate(bearer: string): Promise<Result<Principal, AuthnError>>;
}

export class StaticBearerAuthn implements AuthnPort {
  constructor(private readonly principals: ReadonlyMap<string, Principal>) {}
  async authenticate(bearer: string): Promise<Result<Principal, AuthnError>> {
    if (!bearer) return err({ type: 'missing-token' });
    const p = this.principals.get(bearer);
    if (!p) return err({ type: 'bad-signature' });
    return ok(p);
  }
}
