// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { compactSign, HmacSigner, InMemoryTrustlist, compactVerify } from '@transportial/crypto';
import type { BdiAllowedAlg } from '@transportial/kernel';
import type { SignerPort } from '../../application/ports.ts';

export class JwsSigner implements SignerPort {
  readonly kid: string;
  private readonly inner: HmacSigner;
  private readonly alg: BdiAllowedAlg;

  constructor(options: { kid: string; key: Uint8Array; alg?: BdiAllowedAlg }) {
    this.kid = options.kid;
    this.inner = new HmacSigner(options.key);
    this.alg = options.alg ?? 'ES256';
  }

  async signJwt(claims: unknown): Promise<string> {
    return compactSign(claims, this.inner, { kid: this.kid, alg: this.alg });
  }

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
