// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type {
  PayloadInspectionRequest,
  PayloadInspectionResult,
  PayloadInspectorPort,
} from '@transportial/contracts';
import type { MmtRsmValidator } from './validator.ts';
import { MinimalMmtRsmValidator } from './validator.ts';

// Default content-type marker for MMT-RSM payloads. UN/CEFACT messages are
// historically XML, but the BDI ecosystem exchanges JSON projections of the
// BSP RDM; the vendor sub-type lets the connector distinguish MMT-RSM
// requests from plain JSON without sniffing the body.
export const MMT_RSM_CONTENT_TYPE = 'application/vnd.uncefact.mmt-rsm+json';

export interface MmtRsmInspectorOptions {
  readonly pathPrefixes?: ReadonlyArray<string>;
  readonly extraContentTypes?: ReadonlyArray<string>;
  readonly validator?: MmtRsmValidator;
  readonly methods?: ReadonlyArray<string>;
}

export class MmtRsmPayloadInspector implements PayloadInspectorPort {
  readonly name = 'mmt-rsm';
  private readonly contentTypes: ReadonlySet<string>;
  private readonly pathPrefixes: ReadonlyArray<string>;
  private readonly methods: ReadonlySet<string>;
  private readonly validator: MmtRsmValidator;

  constructor(options: MmtRsmInspectorOptions = {}) {
    this.contentTypes = new Set(
      [MMT_RSM_CONTENT_TYPE, ...(options.extraContentTypes ?? [])].map((c) => c.toLowerCase()),
    );
    this.pathPrefixes = options.pathPrefixes ?? [];
    this.methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH']).map((m) => m.toUpperCase()));
    this.validator = options.validator ?? new MinimalMmtRsmValidator();
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
        reason: 'mmt-rsm-json-parse-failed',
        details: [e instanceof Error ? e.message : 'invalid json'],
      };
    }
    const result = this.validator.validate(parsed);
    if (!result.ok) {
      return { ok: false, reason: 'mmt-rsm-validation-failed', details: result.errors };
    }
    return {
      ok: true,
      resourceTags: {
        'mmt-rsm.version': this.validator.version,
        'mmt-rsm.entityType': result.entityType,
        'mmt-rsm.id': result.id,
      },
    };
  }
}

function baseContentType(value: string): string {
  const semi = value.indexOf(';');
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}
