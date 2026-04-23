// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { RawSigner } from './jws.ts';

// HMAC-SHA-256 signer — NOT part of the BDI wire profile (which requires asymmetric
// algorithms), but essential for unit-testing JWS plumbing without exposing test
// code to the complexities of key-pair generation. It implements the RawSigner
// interface the production EdDSA / ES256 / PS256 adapters share.
export class HmacSigner implements RawSigner {
  constructor(private readonly key: Uint8Array) {}

  private async getKey(): Promise<CryptoKey> {
    // Copy to a fresh ArrayBuffer to satisfy the strict BufferSource type.
    const buf = new ArrayBuffer(this.key.byteLength);
    new Uint8Array(buf).set(this.key);
    return crypto.subtle.importKey(
      'raw',
      buf,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const k = await this.getKey();
    const buf = copyToFreshBuffer(payload);
    const sig = await crypto.subtle.sign('HMAC', k, buf);
    return new Uint8Array(sig);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const k = await this.getKey();
    return crypto.subtle.verify(
      'HMAC',
      k,
      copyToFreshBuffer(signature),
      copyToFreshBuffer(payload),
    );
  }
}

function copyToFreshBuffer(input: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  return buf;
}
