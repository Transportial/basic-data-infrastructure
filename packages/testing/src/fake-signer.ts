// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export interface SignerPort {
  signJwt(claims: unknown): Promise<string>;
  verifyJwt(compact: string): Promise<unknown>;
  readonly kid: string;
}

// FakeSigner produces a compact "JWS-like" triplet we can round-trip without any
// real cryptography. Format: "<header-b64>.<payload-b64>.<sig>" where <sig> is
// "fake-<kid>" so tests can verify the intended signer was used.
export class FakeSigner implements SignerPort {
  constructor(public readonly kid: string = 'fake-key-1') {}

  async signJwt(claims: unknown): Promise<string> {
    const header = encode({ alg: 'fake', kid: this.kid });
    const payload = encode(claims);
    return `${header}.${payload}.fake-${this.kid}`;
  }

  async verifyJwt(compact: string): Promise<unknown> {
    const [headerB64, payloadB64, sig] = compact.split('.');
    if (!headerB64 || !payloadB64 || !sig) throw new Error('malformed compact');
    if (!sig.startsWith('fake-')) throw new Error('bad signature');
    return decode(payloadB64);
  }
}

function encode(x: unknown): string {
  return Buffer.from(JSON.stringify(x), 'utf-8').toString('base64url');
}

function decode(b64: string): unknown {
  return JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
}
