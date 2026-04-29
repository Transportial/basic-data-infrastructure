// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type AssociationId = Brand<string, 'AssociationId'>;

export type AssociationIdParseError =
  | { type: 'empty' }
  | { type: 'bad-format' };

const PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export function parseAssociationId(raw: string): Result<AssociationId, AssociationIdParseError> {
  if (!raw) return err({ type: 'empty' });
  if (!PATTERN.test(raw)) return err({ type: 'bad-format' });
  return ok(raw as AssociationId);
}

export function isAssociationId(x: unknown): x is AssociationId {
  return typeof x === 'string' && parseAssociationId(x).ok;
}
