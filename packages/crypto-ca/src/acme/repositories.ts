// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { jwkThumbprint } from '@bdi/kernel';
import type {
  AccountRepository,
  AuthorizationRepository,
  CertificateRepository,
  EabStore,
  NonceStore,
  OrderRepository,
} from './ports.ts';
import type {
  AcmeAccount,
  AcmeOrder,
  Authorization,
  EabCredential,
  IssuedCertificate,
  Nonce,
} from './types.ts';

export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, AcmeAccount>();
  private readonly byThumbprint = new Map<string, AcmeAccount>();

  async save(account: AcmeAccount): Promise<void> {
    this.byId.set(account.id, account);
    const t = await jwkThumbprint(account.publicJwk);
    this.byThumbprint.set(t, account);
  }

  async find(id: string): Promise<AcmeAccount | null> {
    return this.byId.get(id) ?? null;
  }

  async findByJwkThumbprint(thumbprint: string): Promise<AcmeAccount | null> {
    return this.byThumbprint.get(thumbprint) ?? null;
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  private readonly byId = new Map<string, AcmeOrder>();

  async save(order: AcmeOrder): Promise<void> {
    this.byId.set(order.id, order);
  }

  async find(id: string): Promise<AcmeOrder | null> {
    return this.byId.get(id) ?? null;
  }

  async listByAccount(accountId: string): Promise<ReadonlyArray<AcmeOrder>> {
    return [...this.byId.values()].filter((o) => o.accountId === accountId);
  }
}

export class InMemoryAuthorizationRepository implements AuthorizationRepository {
  private readonly byId = new Map<string, Authorization>();

  async save(authz: Authorization): Promise<void> {
    this.byId.set(authz.id, authz);
  }

  async find(id: string): Promise<Authorization | null> {
    return this.byId.get(id) ?? null;
  }
}

export class InMemoryNonceStore implements NonceStore {
  private readonly store = new Map<string, Nonce>();
  private readonly ttlMs: number;

  constructor(ttlMs = 15 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async issue(): Promise<string> {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const value = base64UrlEncode(bytes);
    this.store.set(value, { value, issuedAt: Date.now(), used: false });
    this.prune();
    return value;
  }

  async consume(value: string): Promise<boolean> {
    this.prune();
    const n = this.store.get(value);
    if (!n || n.used) return false;
    this.store.set(value, { ...n, used: true });
    // Remove used nonces immediately to prevent replay.
    this.store.delete(value);
    return true;
  }

  async pending(): Promise<ReadonlyArray<Nonce>> {
    return [...this.store.values()].filter((n) => !n.used);
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [k, v] of this.store) {
      if (v.issuedAt < cutoff) this.store.delete(k);
    }
  }
}

export class InMemoryEabStore implements EabStore {
  private readonly byKid = new Map<string, EabCredential>();

  register(cred: EabCredential): void {
    this.byKid.set(cred.kid, cred);
  }

  async find(kid: string): Promise<EabCredential | null> {
    return this.byKid.get(kid) ?? null;
  }

  async markUsed(kid: string, at: string): Promise<void> {
    const existing = this.byKid.get(kid);
    if (!existing) return;
    this.byKid.set(kid, { ...existing, usedAt: at });
  }
}

export class InMemoryCertificateRepository implements CertificateRepository {
  private readonly bySerial = new Map<string, IssuedCertificate>();

  async save(cert: IssuedCertificate): Promise<void> {
    this.bySerial.set(cert.serial, cert);
  }

  async find(serial: string): Promise<IssuedCertificate | null> {
    return this.bySerial.get(serial) ?? null;
  }

  async listRevoked(): Promise<ReadonlyArray<IssuedCertificate>> {
    return [...this.bySerial.values()].filter((c) => c.revokedAt);
  }

  async listAll(): Promise<ReadonlyArray<IssuedCertificate>> {
    return [...this.bySerial.values()];
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
