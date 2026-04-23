// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { Jwk } from '@bdi/kernel';
import { base64UrlEncode, jwkThumbprint } from '@bdi/kernel';
import type { RawSigner } from './jws.ts';

export type KeyAlg = 'ES256' | 'ES384' | 'EdDSA' | 'PS256';

export interface KeyPairMaterial {
  readonly alg: KeyAlg;
  readonly publicJwk: Jwk;
  readonly privateJwk: Jwk;
  readonly kid: string;
}

const GEN_PARAMS: Record<KeyAlg, EcKeyGenParams | RsaHashedKeyGenParams | { name: string }> = {
  ES256: { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams,
  ES384: { name: 'ECDSA', namedCurve: 'P-384' } as EcKeyGenParams,
  EdDSA: { name: 'Ed25519' },
  PS256: {
    name: 'RSA-PSS',
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: { name: 'SHA-256' },
  } as RsaHashedKeyGenParams,
};

export async function generateKeyPair(alg: KeyAlg): Promise<KeyPairMaterial> {
  const params = GEN_PARAMS[alg];
  const usages: KeyUsage[] = ['sign', 'verify'];
  const pair = (await crypto.subtle.generateKey(
    params as AlgorithmIdentifier,
    true,
    usages,
  )) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as unknown as Jwk;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as unknown as Jwk;
  const kid = await jwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  privateJwk.kid = kid;
  if (alg === 'ES256' || alg === 'ES384') publicJwk.alg = alg;
  return { alg, publicJwk, privateJwk, kid };
}

export class JwkSigner implements RawSigner {
  constructor(
    private readonly privateJwk: Jwk,
    readonly alg: KeyAlg,
  ) {}

  private async getKey(usage: 'sign' | 'verify'): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'jwk',
      this.privateJwk as unknown as JsonWebKey,
      this.importParams(),
      false,
      [usage],
    );
  }

  private importParams(): AlgorithmIdentifier | EcKeyImportParams | RsaHashedImportParams {
    switch (this.alg) {
      case 'ES256':
        return { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyImportParams;
      case 'ES384':
        return { name: 'ECDSA', namedCurve: 'P-384' } as EcKeyImportParams;
      case 'EdDSA':
        return { name: 'Ed25519' };
      case 'PS256':
        return { name: 'RSA-PSS', hash: { name: 'SHA-256' } } as RsaHashedImportParams;
    }
  }

  private signParams(): AlgorithmIdentifier | EcdsaParams | RsaPssParams {
    switch (this.alg) {
      case 'ES256':
        return { name: 'ECDSA', hash: { name: 'SHA-256' } } as EcdsaParams;
      case 'ES384':
        return { name: 'ECDSA', hash: { name: 'SHA-384' } } as EcdsaParams;
      case 'EdDSA':
        return { name: 'Ed25519' };
      case 'PS256':
        return { name: 'RSA-PSS', saltLength: 32 } as RsaPssParams;
    }
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const key = await this.getKey('sign');
    const sig = await crypto.subtle.sign(this.signParams(), key, toBuffer(payload));
    return new Uint8Array(sig);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = publicJwk(this.privateJwk);
    const key = await crypto.subtle.importKey(
      'jwk',
      pub as unknown as JsonWebKey,
      this.importParams(),
      false,
      ['verify'],
    );
    return crypto.subtle.verify(this.signParams(), key, toBuffer(signature), toBuffer(payload));
  }
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export function publicJwk(privateJwk: Jwk): Jwk {
  const copy = { ...privateJwk };
  delete (copy as { d?: string }).d;
  delete (copy as { p?: string }).p;
  delete (copy as { q?: string }).q;
  delete (copy as { dp?: string }).dp;
  delete (copy as { dq?: string }).dq;
  delete (copy as { qi?: string }).qi;
  // WebCrypto's exportKey sets key_ops=['sign'] on the private key; re-importing
  // those ops for a 'verify' operation fails. Strip them so the resulting JWK is
  // a pure public key with unrestricted use.
  delete (copy as { key_ops?: string[] }).key_ops;
  delete (copy as { ext?: boolean }).ext;
  return copy;
}

export { base64UrlEncode };
