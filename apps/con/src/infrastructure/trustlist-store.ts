// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { BvadClaims } from '@transportial/contracts';
import { compactVerify, type TrustlistResolver } from '@transportial/crypto';
import { validateBvadClaims } from '@transportial/contracts';
import type { TrustlistPort } from '../application/ports.ts';

// The trustlist store is the local cache of the signed trustlist published by
// the ASR. It verifies BVAD tokens by resolving `kid` and optional `x5t#S256`
// against the trustlist entries. In production we'd subscribe to Valkey
// Pub/Sub for invalidations; the in-memory implementation is fully sufficient
// for single-instance deployments and for unit tests.
export class TrustlistStore implements TrustlistPort {
  private resolver: TrustlistResolver;
  constructor(resolver: TrustlistResolver) {
    this.resolver = resolver;
  }

  async refresh(): Promise<void> {
    // Hook that a production adapter overrides; the default in-memory store is
    // pre-populated at composition time. Keeping this no-op means the use case
    // code doesn't branch.
  }

  async verifyBvad(compact: string): Promise<BvadClaims | null> {
    const verified = await compactVerify(compact, this.resolver);
    if (!verified.ok) return null;
    const parsed = validateBvadClaims(verified.value.payload);
    if (!parsed.ok) return null;
    return parsed.value;
  }

  setResolver(next: TrustlistResolver): void {
    this.resolver = next;
  }
}
