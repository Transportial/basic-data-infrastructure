// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type Euid = Brand<string, 'Euid'>;

const PATTERN = /^(?<country>[A-Z]{2})\.(?<register>[A-Z]+)\.(?<id>[A-Z0-9-]+)$/;

export type EuidParseError =
  | { type: 'empty' }
  | { type: 'bad-format'; value: string }
  | { type: 'unknown-country'; country: string };

export const KNOWN_COUNTRIES = new Set([
  'NL', 'BE', 'DE', 'AT', 'FR', 'CH', 'LU', 'IT', 'ES', 'PT', 'DK', 'SE', 'NO', 'FI', 'IE',
]);

export function parseEuid(raw: string): Result<Euid, EuidParseError> {
  if (!raw) return err({ type: 'empty' });
  const match = PATTERN.exec(raw);
  if (!match?.groups) return err({ type: 'bad-format', value: raw });
  const country = match.groups.country!;
  if (!KNOWN_COUNTRIES.has(country)) {
    return err({ type: 'unknown-country', country });
  }
  return ok(raw as Euid);
}

export function isEuid(x: unknown): x is Euid {
  return typeof x === 'string' && parseEuid(x).ok;
}

export function euidCountry(id: Euid): string {
  return id.split('.')[0]!;
}

export function euidRegister(id: Euid): string {
  return id.split('.')[1]!;
}

export function euidLocalId(id: Euid): string {
  return id.split('.').slice(2).join('.');
}
