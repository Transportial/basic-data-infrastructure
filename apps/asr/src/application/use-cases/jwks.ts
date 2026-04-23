// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Jwk } from '@bdi/kernel';

export interface JwksService {
  current(): Promise<ReadonlyArray<Jwk>>;
}

// A keystore holds the active, next, and retired keys for the ASR. The
// reference implementation keeps them in memory; production operators plug in
// an HSM/KMS-backed adapter implementing the same interface.
export interface KeystoreRecord {
  readonly kid: string;
  readonly alg: 'ES256' | 'ES384' | 'EdDSA' | 'PS256';
  readonly publicJwk: Jwk;
  readonly status: 'active' | 'next' | 'retired';
  readonly issuedAt: string;
  readonly retiredAt?: string;
}

export interface Keystore {
  all(): Promise<ReadonlyArray<KeystoreRecord>>;
  active(): Promise<KeystoreRecord>;
  next(): Promise<KeystoreRecord | null>;
  promoteNextToActive(newNext: KeystoreRecord): Promise<void>;
}

export class InMemoryKeystore implements Keystore {
  private records: KeystoreRecord[] = [];

  constructor(initial: KeystoreRecord) {
    this.records.push(initial);
  }

  async all(): Promise<ReadonlyArray<KeystoreRecord>> {
    return [...this.records];
  }

  async active(): Promise<KeystoreRecord> {
    const a = this.records.find((r) => r.status === 'active');
    if (!a) throw new Error('keystore has no active key');
    return a;
  }

  async next(): Promise<KeystoreRecord | null> {
    return this.records.find((r) => r.status === 'next') ?? null;
  }

  async promoteNextToActive(newNext: KeystoreRecord): Promise<void> {
    const now = new Date().toISOString();
    this.records = this.records.map((r) => {
      if (r.status === 'active') return { ...r, status: 'retired', retiredAt: now };
      if (r.status === 'next') return { ...r, status: 'active' };
      return r;
    });
    this.records.push({ ...newNext, status: 'next' });
  }

  seedNext(next: KeystoreRecord): void {
    this.records.push({ ...next, status: 'next' });
  }
}

export class InMemoryJwksService implements JwksService {
  constructor(private readonly keystore: Keystore) {}
  async current(): Promise<ReadonlyArray<Jwk>> {
    const records = await this.keystore.all();
    return records
      .filter((r) => r.status === 'active' || r.status === 'next')
      .map((r) => r.publicJwk);
  }
}
