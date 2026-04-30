// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/con';
import type { EftiValidator } from './validator.ts';
import { MinimalEftiValidator } from './validator.ts';

// Default content-type marker for eFTI payloads. Per the eFTI common dataset
// specification, eFTI entities are exchanged as JSON over the eFTI gateway;
// the vendor sub-type lets the connector distinguish eFTI-bearing requests
// from plain JSON without sniffing the body.
export const EFTI_CONTENT_TYPE = 'application/vnd.efti+json';

export interface EftiInspectorOptions {
  // Optional path-prefix gate. When set, only requests whose path starts with
  // one of the prefixes are inspected. Useful when an upstream uses plain
  // application/json on a dedicated eFTI route.
  readonly pathPrefixes?: ReadonlyArray<string>;
  // Additional content types to treat as eFTI. The vendor sub-type
  // application/vnd.efti+json is always recognised.
  readonly extraContentTypes?: ReadonlyArray<string>;
  // Plug in a richer validator (e.g. Ajv-backed) here. Defaults to the
  // bundled MinimalEftiValidator.
  readonly validator?: EftiValidator;
  // HTTP methods that carry an eFTI body. Defaults to POST/PUT/PATCH.
  readonly methods?: ReadonlyArray<string>;
}

// EftiPayloadInspector is the connector-side hook that the recipe installs.
// It matches eFTI-bearing requests by content-type (and optional path
// prefix), validates the body against the configured EftiValidator, and
// surfaces the entity type and id as resource tags so the connector's PDP
// can authorise using eFTI-aware attributes (e.g. permit only consignments
// tagged for this chain context).
export class EftiPayloadInspector implements PayloadInspectorPort {
  readonly name = 'efti';
  private readonly contentTypes: ReadonlySet<string>;
  private readonly pathPrefixes: ReadonlyArray<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly validator: EftiValidator;

  constructor(options: EftiInspectorOptions = {}) {
    this.contentTypes = new Set(
      [EFTI_CONTENT_TYPE, ...(options.extraContentTypes ?? [])].map((c) => c.toLowerCase()),
    );
    this.pathPrefixes = options.pathPrefixes ?? [];
    this.methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH']).map((m) => m.toUpperCase()));
    this.validator = options.validator ?? new MinimalEftiValidator();
  }

  matches(req: PayloadInspectionRequest): boolean {
    if (!this.methods.has(req.method.toUpperCase())) return false;
    const ct = baseContentType(req.contentType);
    if (this.contentTypes.has(ct)) return true;
    if (ct === 'application/json' && this.pathPrefixes.length > 0) {
      return this.pathPrefixes.some((p) => req.path.startsWith(p));
    }
    return false;
  }

  async inspect(req: PayloadInspectionRequest): Promise<PayloadInspectionResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body);
    } catch (e) {
      return {
        ok: false,
        reason: 'efti-json-parse-failed',
        details: [e instanceof Error ? e.message : 'invalid json'],
      };
    }
    const result = this.validator.validate(parsed);
    if (!result.ok) {
      return { ok: false, reason: 'efti-validation-failed', details: result.errors };
    }
    return {
      ok: true,
      resourceTags: {
        'efti.version': this.validator.version,
        'efti.entityType': result.entityType,
        'efti.id': result.id,
      },
    };
  }
}

function baseContentType(value: string): string {
  const semi = value.indexOf(';');
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}
