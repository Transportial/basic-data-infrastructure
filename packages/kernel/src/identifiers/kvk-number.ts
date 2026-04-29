// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type KvkNumber = Brand<string, 'KvkNumber'>;

export type KvkParseError =
  | { type: 'empty' }
  | { type: 'bad-length'; length: number }
  | { type: 'not-numeric' };

export function parseKvk(raw: string): Result<KvkNumber, KvkParseError> {
  if (!raw) return err({ type: 'empty' });
  if (raw.length !== 8) return err({ type: 'bad-length', length: raw.length });
  if (!/^[0-9]{8}$/.test(raw)) return err({ type: 'not-numeric' });
  return ok(raw as KvkNumber);
}

export function isKvk(x: unknown): x is KvkNumber {
  return typeof x === 'string' && parseKvk(x).ok;
}
