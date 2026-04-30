// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/con';
import type { FhirR5Validator } from './validator.ts';
import { MinimalFhirR5Validator } from './validator.ts';

// Default content-type marker for FHIR JSON payloads. The IANA-registered
// FHIR media type is application/fhir+json; the optional fhirVersion media
// type parameter (RFC 6838) is allowed to pin to R5.
export const FHIR_CONTENT_TYPE = 'application/fhir+json';

export interface FhirR5InspectorOptions {
  readonly pathPrefixes?: ReadonlyArray<string>;
  readonly extraContentTypes?: ReadonlyArray<string>;
  readonly validator?: FhirR5Validator;
  readonly methods?: ReadonlyArray<string>;
}

// FhirR5PayloadInspector matches FHIR-bearing requests by content-type (and
// optional path prefix), validates the body against the configured
// FhirR5Validator, and surfaces resource-level identifiers as resource tags
// so the connector's PDP can authorise on FHIR-aware attributes (e.g. permit
// only Composition resources whose subject matches the chain context's
// patient identifier).
export class FhirR5PayloadInspector implements PayloadInspectorPort {
  readonly name = 'fhir-r5';
  private readonly contentTypes: ReadonlySet<string>;
  private readonly pathPrefixes: ReadonlyArray<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly validator: FhirR5Validator;

  constructor(options: FhirR5InspectorOptions = {}) {
    this.contentTypes = new Set(
      [FHIR_CONTENT_TYPE, ...(options.extraContentTypes ?? [])].map((c) => c.toLowerCase()),
    );
    this.pathPrefixes = options.pathPrefixes ?? [];
    this.methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH']).map((m) => m.toUpperCase()));
    this.validator = options.validator ?? new MinimalFhirR5Validator();
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
        reason: 'fhir-json-parse-failed',
        details: [e instanceof Error ? e.message : 'invalid json'],
      };
    }
    const result = this.validator.validate(parsed);
    if (!result.ok) {
      return { ok: false, reason: 'fhir-validation-failed', details: result.errors };
    }
    const tags: Record<string, string> = {
      'fhir.version': this.validator.version,
      'fhir.resourceType': result.resourceType,
    };
    if (result.id !== undefined) tags['fhir.id'] = result.id;
    return { ok: true, resourceTags: tags };
  }
}

function baseContentType(value: string): string {
  const semi = value.indexOf(';');
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}
