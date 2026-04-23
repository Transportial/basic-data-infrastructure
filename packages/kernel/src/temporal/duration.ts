// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';

export type DurationParseError = { type: 'bad-format'; value: string };

// Minimal ISO-8601 duration parser: PnDTnHnMnS (no years/months for clarity)
const PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export interface DurationSeconds {
  readonly seconds: number;
}

export function parseDuration(iso: string): Result<DurationSeconds, DurationParseError> {
  if (!iso) return err({ type: 'bad-format', value: iso });
  const match = PATTERN.exec(iso);
  if (!match) return err({ type: 'bad-format', value: iso });
  const [, d, h, m, s] = match;
  if (!d && !h && !m && !s) return err({ type: 'bad-format', value: iso });
  const seconds =
    Number.parseInt(d ?? '0', 10) * 86400 +
    Number.parseInt(h ?? '0', 10) * 3600 +
    Number.parseInt(m ?? '0', 10) * 60 +
    Number.parseFloat(s ?? '0');
  return ok({ seconds });
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 0) throw new RangeError('negative duration');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let out = 'P';
  if (d > 0) out += `${d}D`;
  if (h > 0 || m > 0 || s > 0) {
    out += 'T';
    if (h > 0) out += `${h}H`;
    if (m > 0) out += `${m}M`;
    if (s > 0) out += `${s}S`;
  } else if (d === 0) {
    out += 'T0S';
  }
  return out;
}
