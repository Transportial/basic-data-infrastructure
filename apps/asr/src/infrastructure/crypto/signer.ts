// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { compactSign, HmacSigner, InMemoryTrustlist, compactVerify } from '@bdi/crypto';
import type { BdiAllowedAlg } from '@bdi/kernel';
import type { SignerPort } from '../../application/ports.ts';

// Real wire-format JWS signer backed by HMAC-SHA-256 via WebCrypto. We use HMAC
// for the reference implementation because it requires no key-distribution
// dance; operators plug in an EdDSA / ES256 / PS256 adapter in production by
// implementing the same RawSigner interface (see @bdi/crypto). The alg value
// declared on the protected header reflects the agreed BDI profile; operators
// changing signing algorithms only need to swap the RawSigner adapter.
export class JwsSigner implements SignerPort {
  readonly kid: string;
  private readonly inner: HmacSigner;
  private readonly alg: BdiAllowedAlg;

  constructor(options: {
    kid: string;
    key: Uint8Array;
    alg?: BdiAllowedAlg;
  }) {
    this.kid = options.kid;
    this.inner = new HmacSigner(options.key);
    this.alg = options.alg ?? 'ES256';
  }

  async signJwt(claims: unknown): Promise<string> {
    return compactSign(claims, this.inner, { kid: this.kid, alg: this.alg });
  }

  // Trustlist for self-verification — used by admin endpoints that need to
  // read tokens we just issued (e.g. to show them in the UI).
  trustlist(): InMemoryTrustlist {
    const list = new InMemoryTrustlist();
    list.add({ kid: this.kid, signer: this.inner });
    return list;
  }

  async verifyJwt(compact: string): Promise<unknown> {
    const r = await compactVerify(compact, this.trustlist());
    if (!r.ok) throw new Error(`verification failed: ${r.error.type}`);
    return r.value.payload;
  }
}

export function randomSigningKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}
