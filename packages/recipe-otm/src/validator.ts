// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  OTM_DISCRIMINATOR,
  OTM_REQUIRED_FIELDS,
  OTM_VERSION,
  isKnownOtmEntityType,
  type OtmEntityType,
} from './schemas/otm-5.8.ts';

export interface OtmValidationOk {
  readonly ok: true;
  readonly entityType: OtmEntityType;
  readonly id: string;
}

export interface OtmValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type OtmValidationResult = OtmValidationOk | OtmValidationErr;

// OtmValidator is the recipe's validation seam. The bundled
// MinimalOtmValidator does a structural check against the pinned OTM 5.8
// entity surface; production users who want full JSON-Schema validation can
// implement this interface against the upstream OpenAPI document (Ajv,
// quicktype, etc.) and inject it into the recipe.
export interface OtmValidator {
  readonly version: string;
  validate(payload: unknown): OtmValidationResult;
}

// MinimalOtmValidator validates that a payload looks like a single OTM root
// entity — has the required discriminator, names a known entity type, has an
// id, and carries every required field for that entity type. It does NOT
// recurse into nested fields. That is by design: the recipe is a fast
// structural gate, not a replacement for full schema validation.
export class MinimalOtmValidator implements OtmValidator {
  readonly version = OTM_VERSION;

  validate(payload: unknown): OtmValidationResult {
    const errors: string[] = [];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a JSON object'] };
    }
    const obj = payload as Record<string, unknown>;
    const discriminator = obj[OTM_DISCRIMINATOR];
    if (!isKnownOtmEntityType(discriminator)) {
      return {
        ok: false,
        errors: [`${OTM_DISCRIMINATOR} must be one of the OTM ${OTM_VERSION} entity types`],
      };
    }
    const id = obj['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('id must be a non-empty string');
    }
    for (const field of OTM_REQUIRED_FIELDS[discriminator]) {
      if (field === 'id' || field === OTM_DISCRIMINATOR) continue;
      if (!(field in obj)) errors.push(`missing required field '${field}' for ${discriminator}`);
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, entityType: discriminator, id: id as string };
  }
}
