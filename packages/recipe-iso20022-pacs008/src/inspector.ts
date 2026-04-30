// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/con';
import type { Pacs008Validator } from './validator.ts';
import { MinimalPacs008Validator } from './validator.ts';

// Default content-type marker for ISO 20022 JSON payloads. ISO 20022 is
// historically XML; JSON projections are exchanged on modern rails. The
// vendor sub-type lets the connector distinguish ISO 20022 messages from
// plain JSON without sniffing the body.
export const ISO20022_CONTENT_TYPE = 'application/vnd.iso20022+json';

export interface Pacs008InspectorOptions {
  readonly pathPrefixes?: ReadonlyArray<string>;
  readonly extraContentTypes?: ReadonlyArray<string>;
  readonly validator?: Pacs008Validator;
  readonly methods?: ReadonlyArray<string>;
}

// Pacs008PayloadInspector is the connector-side hook that the recipe
// installs. It matches ISO 20022 pacs.008 requests by content-type (and
// optional path prefix), validates the body against the configured
// Pacs008Validator, and surfaces the message id, transaction count and
// (when available) the first end-to-end id as resource tags so the
// connector's PDP can authorise on settlement-aware attributes.
export class Pacs008PayloadInspector implements PayloadInspectorPort {
  readonly name = 'iso20022-pacs008';
  private readonly contentTypes: ReadonlySet<string>;
  private readonly pathPrefixes: ReadonlyArray<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly validator: Pacs008Validator;

  constructor(options: Pacs008InspectorOptions = {}) {
    this.contentTypes = new Set(
      [ISO20022_CONTENT_TYPE, ...(options.extraContentTypes ?? [])].map((c) => c.toLowerCase()),
    );
    this.pathPrefixes = options.pathPrefixes ?? [];
    this.methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH']).map((m) => m.toUpperCase()));
    this.validator = options.validator ?? new MinimalPacs008Validator();
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
        reason: 'pacs008-json-parse-failed',
        details: [e instanceof Error ? e.message : 'invalid json'],
      };
    }
    const result = this.validator.validate(parsed);
    if (!result.ok) {
      return { ok: false, reason: 'pacs008-validation-failed', details: result.errors };
    }
    const tags: Record<string, string> = {
      'iso20022.message': this.validator.messageDefinition,
      'iso20022.msgId': result.msgId,
      'iso20022.txCount': String(result.txCount),
    };
    if (result.firstEndToEndId !== undefined) {
      tags['iso20022.endToEndId'] = result.firstEndToEndId;
    }
    return { ok: true, resourceTags: tags };
  }
}

function baseContentType(value: string): string {
  const semi = value.indexOf(';');
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}
