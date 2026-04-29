// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type IsoInstant = Brand<string, 'IsoInstant'>;

export type InstantParseError = { type: 'bad-format'; value: string };

export function parseInstant(raw: string): Result<IsoInstant, InstantParseError> {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return err({ type: 'bad-format', value: raw });
  return ok(d.toISOString() as IsoInstant);
}

export function instantFromUnix(unixSeconds: number): IsoInstant {
  return new Date(unixSeconds * 1000).toISOString() as IsoInstant;
}

export function instantToUnix(i: IsoInstant): number {
  return Math.floor(new Date(i).getTime() / 1000);
}

export function addSeconds(i: IsoInstant, seconds: number): IsoInstant {
  return new Date(new Date(i).getTime() + seconds * 1000).toISOString() as IsoInstant;
}

export function isBefore(a: IsoInstant, b: IsoInstant): boolean {
  return new Date(a).getTime() < new Date(b).getTime();
}

export function isAfter(a: IsoInstant, b: IsoInstant): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}
