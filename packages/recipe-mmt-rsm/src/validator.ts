// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  MMT_RSM_DISCRIMINATOR,
  MMT_RSM_REQUIRED_FIELDS,
  MMT_RSM_VERSION,
  isKnownMmtRsmEntityType,
  type MmtRsmEntityType,
} from './schemas/mmt-rsm.ts';

export interface MmtRsmValidationOk {
  readonly ok: true;
  readonly entityType: MmtRsmEntityType;
  readonly id: string;
}

export interface MmtRsmValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type MmtRsmValidationResult = MmtRsmValidationOk | MmtRsmValidationErr;

// MmtRsmValidator is the recipe's validation seam. The bundled
// MinimalMmtRsmValidator does a structural check against the pinned MMT-RSM
// entity surface; production users who want full schema validation can
// implement this interface against the upstream UN/CEFACT XSDs (or a JSON
// projection thereof) and inject it into the recipe.
export interface MmtRsmValidator {
  readonly version: string;
  validate(payload: unknown): MmtRsmValidationResult;
}

export class MinimalMmtRsmValidator implements MmtRsmValidator {
  readonly version = MMT_RSM_VERSION;

  validate(payload: unknown): MmtRsmValidationResult {
    const errors: string[] = [];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a JSON object'] };
    }
    const obj = payload as Record<string, unknown>;
    const discriminator = obj[MMT_RSM_DISCRIMINATOR];
    if (!isKnownMmtRsmEntityType(discriminator)) {
      return {
        ok: false,
        errors: [
          `${MMT_RSM_DISCRIMINATOR} must be one of the MMT-RSM ${MMT_RSM_VERSION} entity types`,
        ],
      };
    }
    const id = obj['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('id must be a non-empty string');
    }
    for (const field of MMT_RSM_REQUIRED_FIELDS[discriminator]) {
      if (field === 'id' || field === MMT_RSM_DISCRIMINATOR) continue;
      if (!(field in obj)) errors.push(`missing required field '${field}' for ${discriminator}`);
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, entityType: discriminator, id: id as string };
  }
}
