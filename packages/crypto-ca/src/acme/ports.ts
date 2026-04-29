// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  AcmeAccount,
  AcmeOrder,
  Authorization,
  EabCredential,
  IssuedCertificate,
  Nonce,
} from './types.ts';

export interface AccountRepository {
  save(account: AcmeAccount): Promise<void>;
  find(id: string): Promise<AcmeAccount | null>;
  findByJwkThumbprint(thumbprint: string): Promise<AcmeAccount | null>;
}

export interface OrderRepository {
  save(order: AcmeOrder): Promise<void>;
  find(id: string): Promise<AcmeOrder | null>;
  listByAccount(accountId: string): Promise<ReadonlyArray<AcmeOrder>>;
}

export interface AuthorizationRepository {
  save(authz: Authorization): Promise<void>;
  find(id: string): Promise<Authorization | null>;
}

export interface NonceStore {
  issue(): Promise<string>;
  consume(value: string): Promise<boolean>;
  pending(): Promise<ReadonlyArray<Nonce>>;
}

export interface EabStore {
  find(kid: string): Promise<EabCredential | null>;
  markUsed(kid: string, at: string): Promise<void>;
}

export interface CertificateRepository {
  save(cert: IssuedCertificate): Promise<void>;
  find(serial: string): Promise<IssuedCertificate | null>;
  listRevoked(): Promise<ReadonlyArray<IssuedCertificate>>;
  listAll(): Promise<ReadonlyArray<IssuedCertificate>>;
}

export interface HttpChallengeVerifier {
  verify(identifier: string, token: string, keyAuthorization: string): Promise<boolean>;
}

export interface DnsChallengeVerifier {
  verify(identifier: string, expectedTxt: string): Promise<boolean>;
}

export interface TlsAlpnChallengeVerifier {
  verify(identifier: string, keyAuthorization: string): Promise<boolean>;
}
