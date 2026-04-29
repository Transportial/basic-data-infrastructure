// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type ChainContextId = Brand<string, 'ChainContextId'>;

export type ChainContextIdParseError =
  | { type: 'empty' }
  | { type: 'bad-uuid' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseChainContextId(raw: string): Result<ChainContextId, ChainContextIdParseError> {
  if (!raw) return err({ type: 'empty' });
  if (!UUID_RE.test(raw)) return err({ type: 'bad-uuid' });
  return ok(raw.toLowerCase() as ChainContextId);
}

export function isChainContextId(x: unknown): x is ChainContextId {
  return typeof x === 'string' && parseChainContextId(x).ok;
}
