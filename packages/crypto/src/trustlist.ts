// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { RawSigner, TrustlistResolver } from './jws.ts';

export interface TrustlistEntryRecord {
  readonly kid: string;
  readonly thumbprint?: string;
  readonly signer: RawSigner;
}

export class InMemoryTrustlist implements TrustlistResolver {
  private readonly byKid = new Map<string, TrustlistEntryRecord>();

  add(entry: TrustlistEntryRecord): void {
    this.byKid.set(entry.kid, entry);
  }

  remove(kid: string): void {
    this.byKid.delete(kid);
  }

  async resolve(kid: string, x5tS256?: string): Promise<RawSigner | null> {
    const entry = this.byKid.get(kid);
    if (!entry) return null;
    if (x5tS256 && entry.thumbprint && entry.thumbprint !== x5tS256) return null;
    return entry.signer;
  }

  size(): number {
    return this.byKid.size;
  }

  snapshot(): ReadonlyArray<{ kid: string; thumbprint?: string }> {
    return [...this.byKid.values()].map((e) => ({
      kid: e.kid,
      ...(e.thumbprint !== undefined ? { thumbprint: e.thumbprint } : {}),
    }));
  }
}
