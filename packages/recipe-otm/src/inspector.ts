// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/contracts';
import type { OtmValidator } from './validator.ts';
import { MinimalOtmValidator } from './validator.ts';

// Default content-type marker for OTM payloads. Per the OTM API spec, OTM
// entities are exchanged as JSON; the vendor sub-type lets the connector
// distinguish OTM-bearing requests from plain JSON without sniffing the body.
export const OTM_CONTENT_TYPE = 'application/vnd.otm+json';

export interface OtmInspectorOptions {
  // Optional path-prefix gate. When set, only requests whose path starts with
  // one of the prefixes are inspected. Useful when an upstream uses plain
  // application/json on a dedicated OTM route.
  readonly pathPrefixes?: ReadonlyArray<string>;
  // Additional content types to treat as OTM. The vendor sub-type
  // application/vnd.otm+json is always recognised.
  readonly extraContentTypes?: ReadonlyArray<string>;
  // Plug in a richer validator (e.g. Ajv-backed) here. Defaults to the
  // bundled MinimalOtmValidator.
  readonly validator?: OtmValidator;
  // HTTP methods that carry an OTM body. Defaults to POST/PUT/PATCH.
  readonly methods?: ReadonlyArray<string>;
}

// OtmPayloadInspector is the connector-side hook that the recipe installs.
// It matches OTM-bearing requests by content-type (and optional path prefix),
// validates the body against the configured OtmValidator, and surfaces the
// entity type and id as resource tags so the connector's PDP can authorise
// using OTM-aware attributes (e.g. permit only consignments tagged for this
// chain context).
export class OtmPayloadInspector implements PayloadInspectorPort {
  readonly name = 'otm';
  private readonly contentTypes: ReadonlySet<string>;
  private readonly pathPrefixes: ReadonlyArray<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly validator: OtmValidator;

  constructor(options: OtmInspectorOptions = {}) {
    this.contentTypes = new Set(
      [OTM_CONTENT_TYPE, ...(options.extraContentTypes ?? [])].map((c) => c.toLowerCase()),
    );
    this.pathPrefixes = options.pathPrefixes ?? [];
    this.methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH']).map((m) => m.toUpperCase()));
    this.validator = options.validator ?? new MinimalOtmValidator();
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
        reason: 'otm-json-parse-failed',
        details: [e instanceof Error ? e.message : 'invalid json'],
      };
    }
    const result = this.validator.validate(parsed);
    if (!result.ok) {
      return { ok: false, reason: 'otm-validation-failed', details: result.errors };
    }
    return {
      ok: true,
      resourceTags: {
        'otm.version': this.validator.version,
        'otm.entityType': result.entityType,
        'otm.id': result.id,
      },
    };
  }
}

function baseContentType(value: string): string {
  const semi = value.indexOf(';');
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}
