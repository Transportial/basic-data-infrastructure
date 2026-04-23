// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import {
  err,
  ok,
  type Result,
  BDI_PROFILE_VERSION_HEADER,
  BDI_ALLOWED_ALGS,
  validateBdiJwsHeader,
  base64UrlEncode,
  base64UrlDecode,
  type BdiJwsHeader,
} from '@bdi/kernel';

export type JwsError =
  | { type: 'malformed' }
  | { type: 'invalid-header'; reason: string }
  | { type: 'unknown-signer'; kid: string }
  | { type: 'bad-signature' }
  | { type: 'invalid-payload' };

export interface SignOptions {
  readonly kid: string;
  readonly alg: (typeof BDI_ALLOWED_ALGS)[number];
  readonly typ?: string;
  readonly 'x5t#S256'?: string;
  readonly x5c?: string[];
}

// Abstraction so tests can plug in deterministic signers. Production wiring
// would delegate to WebCrypto or a PKCS#11 adapter implementing this interface.
export interface RawSigner {
  sign(payloadBytes: Uint8Array): Promise<Uint8Array>;
  verify(payloadBytes: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export async function compactSign(
  payload: unknown,
  signer: RawSigner,
  options: SignOptions,
): Promise<string> {
  const header: BdiJwsHeader = {
    alg: options.alg,
    kid: options.kid,
    [BDI_PROFILE_VERSION_HEADER]: 1,
    crit: [BDI_PROFILE_VERSION_HEADER],
    ...(options.typ !== undefined ? { typ: options.typ } : {}),
    ...(options['x5t#S256'] !== undefined ? { 'x5t#S256': options['x5t#S256'] } : {}),
    ...(options.x5c !== undefined ? { x5c: options.x5c } : {}),
  };
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await signer.sign(signingInput);
  return `${headerB64}.${payloadB64}.${base64UrlEncode(sig)}`;
}

export interface TrustlistResolver {
  resolve(kid: string, x5tS256?: string): Promise<RawSigner | null>;
}

export interface VerifyResult<T> {
  readonly header: BdiJwsHeader;
  readonly payload: T;
}

export async function compactVerify<T = unknown>(
  compact: string,
  resolver: TrustlistResolver,
): Promise<Result<VerifyResult<T>, JwsError>> {
  const parts = compact.split('.');
  if (parts.length !== 3) return err({ type: 'malformed' });
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let headerJson: unknown;
  try {
    headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  } catch {
    return err({ type: 'malformed' });
  }
  const headerResult = validateBdiJwsHeader(headerJson);
  if (!headerResult.ok) return err({ type: 'invalid-header', reason: headerResult.error.type });
  const header = headerResult.value;

  const signer = await resolver.resolve(header.kid, header['x5t#S256']);
  if (!signer) return err({ type: 'unknown-signer', kid: header.kid });

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const verified = await signer.verify(signingInput, signature);
  if (!verified) return err({ type: 'bad-signature' });

  let payload: T;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as T;
  } catch {
    return err({ type: 'invalid-payload' });
  }

  return ok({ header, payload });
}
