// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { Jwk } from '@transportial/kernel';
import { JwkSigner, type KeyAlg } from '@transportial/crypto';
import { OID } from './oid.ts';
import type { CaSigner } from './acme/server.ts';

export class JwkCaSigner implements CaSigner {
  constructor(
    private readonly inner: JwkSigner,
    readonly algorithmOid: string,
  ) {}

  async sign(tbs: Uint8Array): Promise<Uint8Array> {
    return this.inner.sign(tbs);
  }

  static from(privateJwk: Jwk, alg: KeyAlg): JwkCaSigner {
    const signer = new JwkSigner(privateJwk, alg);
    const oid =
      alg === 'ES256'
        ? OID.ecdsaWithSha256
        : alg === 'ES384'
          ? OID.ecdsaWithSha384
          : alg === 'EdDSA'
            ? OID.ed25519
            : OID.sha256WithRSAEncryption;
    return new JwkCaSigner(signer, oid);
  }
}
