// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { Jwk } from '@transportial/kernel';

export type AccountStatus = 'valid' | 'deactivated' | 'revoked';
export type OrderStatus = 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
export type AuthorizationStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'deactivated'
  | 'expired'
  | 'revoked';
export type ChallengeStatus = 'pending' | 'processing' | 'valid' | 'invalid';
export type ChallengeType = 'http-01' | 'dns-01' | 'tls-alpn-01';

export interface Identifier {
  readonly type: 'dns' | 'ip';
  readonly value: string;
}

export interface AcmeAccount {
  readonly id: string;
  readonly status: AccountStatus;
  readonly contact: ReadonlyArray<string>;
  readonly termsOfServiceAgreed: boolean;
  readonly orders: string;
  readonly createdAt: string;
  readonly publicJwk: Jwk;
  // External Account Binding — this is the key/kid the registration was
  // bound to at account creation; the operator authoritatively associates a
  // client_id with an EAB key when provisioning the connector.
  readonly externalAccountKid: string;
}

export interface Challenge {
  readonly id: string;
  readonly type: ChallengeType;
  readonly status: ChallengeStatus;
  readonly url: string;
  readonly token: string;
  readonly validated?: string;
  readonly error?: AcmeError;
}

export interface Authorization {
  readonly id: string;
  readonly accountId: string;
  readonly orderId: string;
  readonly identifier: Identifier;
  readonly status: AuthorizationStatus;
  readonly expires: string;
  readonly challenges: ReadonlyArray<Challenge>;
  readonly wildcard: boolean;
}

export interface AcmeOrder {
  readonly id: string;
  readonly accountId: string;
  readonly status: OrderStatus;
  readonly expires: string;
  readonly identifiers: ReadonlyArray<Identifier>;
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly authorizationIds: ReadonlyArray<string>;
  readonly finalizeUrl: string;
  readonly certificateSerial?: string;
  readonly error?: AcmeError;
}

export interface Nonce {
  readonly value: string;
  readonly issuedAt: number;
  readonly used: boolean;
}

export interface IssuedCertificate {
  readonly serial: string;
  readonly accountId: string;
  readonly orderId: string;
  readonly pem: string;
  readonly notAfter: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface EabCredential {
  readonly kid: string;
  readonly hmacKey: Uint8Array;
  readonly clientId: string;
  readonly usedAt?: string;
}

export interface AcmeError {
  readonly type: string;
  readonly detail: string;
  readonly status: number;
}
