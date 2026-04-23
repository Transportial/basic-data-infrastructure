// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { generateKeyPair, publicJwk, type KeyAlg } from '@bdi/crypto';
import type { Keystore } from './jwks.ts';
import type { EventBusPort } from '../ports.ts';

// Rotate the association's signing key:
//   1. promote the currently "next" key to "active"
//   2. retire the previously "active" key
//   3. generate a fresh "next" key and publish it in the JWKS immediately
//
// Consumers pick up the new "next" ahead of time (they're already in the
// JWKS) so when the next rotation runs they can still verify tokens issued
// under the old active.
export class RotateKeysUseCase {
  constructor(
    private readonly keystore: Keystore,
    private readonly bus: EventBusPort,
    private readonly associationId: string,
    private readonly alg: KeyAlg = 'ES256',
  ) {}

  async execute(): Promise<{ newActiveKid: string; newNextKid: string }> {
    const existing = await this.keystore.next();
    if (!existing) {
      // First-time provisioning: generate a "next" so the next rotation has
      // something to promote.
      const bootstrap = await generateKeyPair(this.alg);
      const record = {
        kid: bootstrap.kid,
        alg: this.alg,
        publicJwk: publicJwk(bootstrap.publicJwk),
        status: 'next' as const,
        issuedAt: new Date().toISOString(),
      };
      await this.keystore.promoteNextToActive(record);
      const fresh = await generateKeyPair(this.alg);
      await this.keystore.promoteNextToActive({
        kid: fresh.kid,
        alg: this.alg,
        publicJwk: publicJwk(fresh.publicJwk),
        status: 'next' as const,
        issuedAt: new Date().toISOString(),
      });
      await this.bus.publish('asr.keys.rotated', this.associationId, {
        new_active_kid: bootstrap.kid,
        new_next_kid: fresh.kid,
      });
      return { newActiveKid: bootstrap.kid, newNextKid: fresh.kid };
    }
    const fresh = await generateKeyPair(this.alg);
    await this.keystore.promoteNextToActive({
      kid: fresh.kid,
      alg: this.alg,
      publicJwk: publicJwk(fresh.publicJwk),
      status: 'next' as const,
      issuedAt: new Date().toISOString(),
    });
    await this.bus.publish('asr.keys.rotated', this.associationId, {
      new_active_kid: existing.kid,
      new_next_kid: fresh.kid,
    });
    return { newActiveKid: existing.kid, newNextKid: fresh.kid };
  }
}
