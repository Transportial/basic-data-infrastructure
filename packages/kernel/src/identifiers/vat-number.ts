// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type VatNumber = Brand<string, 'VatNumber'>;

export type VatParseError =
  | { type: 'empty' }
  | { type: 'bad-format' }
  | { type: 'unknown-country'; country: string };

// VIES-compatible format: 2-letter country + alphanumeric id (per member state rules)
const VAT_PATTERN = /^(?<country>[A-Z]{2})(?<id>[0-9A-Z+*.]{2,12})$/;

const EU_VAT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'XI',
]);

export function parseVat(raw: string): Result<VatNumber, VatParseError> {
  if (!raw) return err({ type: 'empty' });
  const normalized = raw.toUpperCase().replace(/\s+/g, '');
  const match = VAT_PATTERN.exec(normalized);
  if (!match?.groups) return err({ type: 'bad-format' });
  const country = match.groups.country!;
  if (!EU_VAT_COUNTRIES.has(country)) return err({ type: 'unknown-country', country });
  return ok(normalized as VatNumber);
}

export function isVat(x: unknown): x is VatNumber {
  return typeof x === 'string' && parseVat(x).ok;
}
