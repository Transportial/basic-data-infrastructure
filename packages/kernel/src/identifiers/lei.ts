// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type Lei = Brand<string, 'Lei'>;

export type LeiParseError =
  | { type: 'empty' }
  | { type: 'bad-length'; length: number }
  | { type: 'bad-format' }
  | { type: 'bad-checksum' };

// ISO 17442 LEI: 20 chars, [0-9A-Z], last 2 are checksum digits (ISO 7064 MOD 97-10)
const LEI_PATTERN = /^[0-9A-Z]{18}[0-9]{2}$/;

export function parseLei(raw: string): Result<Lei, LeiParseError> {
  if (!raw) return err({ type: 'empty' });
  if (raw.length !== 20) return err({ type: 'bad-length', length: raw.length });
  if (!LEI_PATTERN.test(raw)) return err({ type: 'bad-format' });
  if (!verifyLeiChecksum(raw)) return err({ type: 'bad-checksum' });
  return ok(raw as Lei);
}

export function verifyLeiChecksum(lei: string): boolean {
  // ISO 7064 MOD 97-10: interpret A-Z as 10-35; result mod 97 must equal 1
  let numeric = '';
  for (const ch of lei) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) numeric += ch;
    else if (code >= 65 && code <= 90) numeric += (code - 55).toString();
    else return false;
  }
  // Big integer mod 97 using chunked calculation
  let remainder = 0;
  for (const d of numeric) {
    remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

export function isLei(x: unknown): x is Lei {
  return typeof x === 'string' && parseLei(x).ok;
}
