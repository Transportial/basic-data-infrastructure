// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { compactVerify, type TrustlistResolver } from '@bdi/crypto';
import { validateBvodClaims, type BvodClaims } from '@bdi/contracts';
import type { OrsTrustPort } from '../application/ports.ts';

export class OrsTrust implements OrsTrustPort {
  constructor(private readonly resolver: TrustlistResolver) {}

  async verifyBvod(compact: string): Promise<BvodClaims | null> {
    const verified = await compactVerify(compact, this.resolver);
    if (!verified.ok) return null;
    const parsed = validateBvodClaims(verified.value.payload);
    if (!parsed.ok) return null;
    return parsed.value;
  }
}
