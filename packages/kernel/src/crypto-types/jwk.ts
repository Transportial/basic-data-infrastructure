// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';

// Minimal JWK type — matches RFC 7517 subset used by BDI profile.
export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  d?: string;
  key_ops?: string[];
  x5t?: string;
  'x5t#S256'?: string;
  x5c?: string[];
}

export type JwkValidationError =
  | { type: 'empty' }
  | { type: 'missing-kty' }
  | { type: 'private-material-leaked' }
  | { type: 'unsupported-kty'; kty: string };

const ALLOWED_KTY = new Set(['OKP', 'EC', 'RSA']);

export function validatePublicJwk(raw: unknown): Result<Jwk, JwkValidationError> {
  if (!raw || typeof raw !== 'object') return err({ type: 'empty' });
  const jwk = raw as Record<string, unknown>;
  if (typeof jwk.kty !== 'string') return err({ type: 'missing-kty' });
  if (!ALLOWED_KTY.has(jwk.kty)) return err({ type: 'unsupported-kty', kty: jwk.kty });
  if (typeof jwk.d === 'string') return err({ type: 'private-material-leaked' });
  return ok(jwk as unknown as Jwk);
}

export function isPublicJwk(x: unknown): x is Jwk {
  return validatePublicJwk(x).ok;
}
