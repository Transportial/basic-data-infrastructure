// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import {
  compactSign,
  HmacSigner,
  InMemoryTrustlist,
  compactVerify,
  JwkSigner,
  type RawSigner,
  type KeyAlg,
  generateKeyPair,
  publicJwk,
} from '@bdi/crypto';
import type { BdiAllowedAlg, Jwk } from '@bdi/kernel';
import type { SignerPort } from '../../application/ports.ts';

export class JwsSigner implements SignerPort {
  readonly kid: string;
  readonly publicJwk: Jwk;
  private readonly inner: RawSigner;
  private readonly alg: BdiAllowedAlg;

  constructor(options: {
    kid: string;
    alg?: BdiAllowedAlg;
    inner: RawSigner;
    publicJwk: Jwk;
  }) {
    this.kid = options.kid;
    this.alg = options.alg ?? 'ES256';
    this.inner = options.inner;
    this.publicJwk = options.publicJwk;
  }

  static async generate(alg: KeyAlg = 'ES256'): Promise<JwsSigner> {
    const kp = await generateKeyPair(alg);
    const inner = new JwkSigner(kp.privateJwk, alg);
    return new JwsSigner({
      kid: kp.kid,
      alg: bdiAlgFor(alg),
      inner,
      publicJwk: publicJwk(kp.publicJwk),
    });
  }

  static fromHmac(kid: string, key: Uint8Array, alg: BdiAllowedAlg = 'ES256'): JwsSigner {
    const inner = new HmacSigner(key);
    // HMAC isn't part of the BDI wire profile; this constructor exists only to
    // support tests and is marked accordingly on the public JWK (which we'd
    // never publish in that mode).
    return new JwsSigner({
      kid,
      alg,
      inner,
      publicJwk: { kty: 'oct', kid, alg: 'HS256' } as unknown as Jwk,
    });
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

function bdiAlgFor(alg: KeyAlg): BdiAllowedAlg {
  switch (alg) {
    case 'ES256':
      return 'ES256';
    case 'ES384':
      return 'ES384';
    case 'EdDSA':
      return 'EdDSA';
    case 'PS256':
      return 'PS256';
  }
}

export function randomSigningKey(): Uint8Array {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}
