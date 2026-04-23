// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Jwk } from '@bdi/kernel';
import { JwkSigner, type KeyAlg } from '@bdi/crypto';
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
