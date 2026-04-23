// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@bdi/kernel';

// We intentionally avoid adding a runtime validation library dependency to keep
// the contracts package self-contained. These validators are tuned to the BDI
// protocol artefacts and return typed errors matching the rest of the kernel.

export type FieldPath = ReadonlyArray<string | number>;

export type ValidationIssue = { path: FieldPath; reason: string };

export type Validator<T> = (input: unknown, path?: FieldPath) => Result<T, ValidationIssue[]>;

export function combineIssues<A, B>(
  a: Result<A, ValidationIssue[]>,
  b: Result<B, ValidationIssue[]>,
): Result<[A, B], ValidationIssue[]> {
  if (!a.ok && !b.ok) return err([...a.error, ...b.error]);
  if (!a.ok) return err(a.error);
  if (!b.ok) return err(b.error);
  return ok([a.value, b.value]);
}

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function issue(path: FieldPath, reason: string): ValidationIssue {
  return { path, reason };
}

export function fail(path: FieldPath, reason: string): Result<never, ValidationIssue[]> {
  return err([issue(path, reason)]);
}
