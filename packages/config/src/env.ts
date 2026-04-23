// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Result } from '@bdi/kernel';

export type EnvSource = Record<string, string | undefined>;

export interface FieldSpec<T> {
  required: boolean;
  default?: T;
  parse(raw: string): Result<T, string>;
  description?: string;
}

export type EnvSchema = Record<string, FieldSpec<unknown>>;

export type InferEnv<S extends EnvSchema> = {
  [K in keyof S]: S[K] extends FieldSpec<infer V>
    ? S[K]['required'] extends true
      ? V
      : V | undefined
    : never;
};

export type EnvError = {
  field: string;
  reason: string;
};

export function loadEnv<S extends EnvSchema>(
  schema: S,
  source: EnvSource = process.env,
): Result<InferEnv<S>, EnvError[]> {
  const errors: EnvError[] = [];
  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = source[key];
    if (raw === undefined || raw === '') {
      if (spec.required && spec.default === undefined) {
        errors.push({ field: key, reason: 'missing required env var' });
        continue;
      }
      result[key] = spec.default;
      continue;
    }
    const parsed = spec.parse(raw);
    if (!parsed.ok) {
      errors.push({ field: key, reason: parsed.error });
      continue;
    }
    result[key] = parsed.value;
  }
  if (errors.length > 0) return err(errors);
  return ok(result as InferEnv<S>);
}

export const parsers = {
  string(opts?: { minLength?: number; maxLength?: number; pattern?: RegExp }) {
    return (raw: string): Result<string, string> => {
      if (opts?.minLength !== undefined && raw.length < opts.minLength)
        return err(`shorter than ${opts.minLength}`);
      if (opts?.maxLength !== undefined && raw.length > opts.maxLength)
        return err(`longer than ${opts.maxLength}`);
      if (opts?.pattern && !opts.pattern.test(raw)) return err(`does not match ${opts.pattern}`);
      return ok(raw);
    };
  },
  integer(opts?: { min?: number; max?: number }) {
    return (raw: string): Result<number, string> => {
      if (!/^-?\d+$/.test(raw)) return err(`not an integer`);
      const n = Number.parseInt(raw, 10);
      if (opts?.min !== undefined && n < opts.min) return err(`below ${opts.min}`);
      if (opts?.max !== undefined && n > opts.max) return err(`above ${opts.max}`);
      return ok(n);
    };
  },
  boolean() {
    return (raw: string): Result<boolean, string> => {
      const lc = raw.toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(lc)) return ok(true);
      if (['0', 'false', 'no', 'off'].includes(lc)) return ok(false);
      return err('not a boolean');
    };
  },
  url() {
    return (raw: string): Result<string, string> => {
      try {
        new URL(raw);
        return ok(raw);
      } catch {
        return err('not a valid URL');
      }
    };
  },
  enum<T extends string>(values: readonly T[]) {
    return (raw: string): Result<T, string> => {
      if ((values as readonly string[]).includes(raw)) return ok(raw as T);
      return err(`not one of [${values.join(', ')}]`);
    };
  },
  csv<T>(inner: (raw: string) => Result<T, string>) {
    return (raw: string): Result<T[], string> => {
      const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const out: T[] = [];
      for (const p of parts) {
        const r = inner(p);
        if (!r.ok) return err(`element "${p}": ${r.error}`);
        out.push(r.value);
      }
      return ok(out);
    };
  },
};

export function formatEnvErrors(errors: EnvError[]): string {
  return (
    'Configuration errors:\n' +
    errors.map((e) => `  - ${e.field}: ${e.reason}`).join('\n')
  );
}
