// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type KboNumber = Brand<string, 'KboNumber'>;

export type KboParseError =
  | { type: 'empty' }
  | { type: 'bad-length'; length: number }
  | { type: 'not-numeric' }
  | { type: 'bad-checksum' };

export function parseKbo(raw: string): Result<KboNumber, KboParseError> {
  if (!raw) return err({ type: 'empty' });
  const digits = raw.replace(/\./g, '');
  if (digits.length !== 10) return err({ type: 'bad-length', length: digits.length });
  if (!/^[0-9]{10}$/.test(digits)) return err({ type: 'not-numeric' });
  // Belgian KBO: last 2 digits are checksum = 97 - (first 8 digits mod 97)
  const base = Number.parseInt(digits.slice(0, 8), 10);
  const check = Number.parseInt(digits.slice(8), 10);
  if (97 - (base % 97) !== check) return err({ type: 'bad-checksum' });
  return ok(digits as KboNumber);
}

export function isKbo(x: unknown): x is KboNumber {
  return typeof x === 'string' && parseKbo(x).ok;
}
