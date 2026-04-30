// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  EFTI_DISCRIMINATOR,
  EFTI_REQUIRED_FIELDS,
  EFTI_VERSION,
  isKnownEftiEntityType,
  type EftiEntityType,
} from './schemas/efti-1.0.ts';

export interface EftiValidationOk {
  readonly ok: true;
  readonly entityType: EftiEntityType;
  readonly id: string;
}

export interface EftiValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type EftiValidationResult = EftiValidationOk | EftiValidationErr;

// EftiValidator is the recipe's validation seam. The bundled
// MinimalEftiValidator does a structural check against the pinned eFTI 1.0
// entity surface; production users who want full XSD/JSON-Schema validation
// can implement this interface against the upstream eFTI dataset definition
// and inject it into the recipe.
export interface EftiValidator {
  readonly version: string;
  validate(payload: unknown): EftiValidationResult;
}

// MinimalEftiValidator validates that a payload looks like a single eFTI
// root entity — has the required discriminator, names a known entity type,
// has an id, and carries every required field for that entity type. It does
// NOT recurse into nested fields. That is by design: the recipe is a fast
// structural gate, not a replacement for full schema validation.
export class MinimalEftiValidator implements EftiValidator {
  readonly version = EFTI_VERSION;

  validate(payload: unknown): EftiValidationResult {
    const errors: string[] = [];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a JSON object'] };
    }
    const obj = payload as Record<string, unknown>;
    const discriminator = obj[EFTI_DISCRIMINATOR];
    if (!isKnownEftiEntityType(discriminator)) {
      return {
        ok: false,
        errors: [`${EFTI_DISCRIMINATOR} must be one of the eFTI ${EFTI_VERSION} entity types`],
      };
    }
    const id = obj['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('id must be a non-empty string');
    }
    for (const field of EFTI_REQUIRED_FIELDS[discriminator]) {
      if (field === 'id' || field === EFTI_DISCRIMINATOR) continue;
      if (!(field in obj)) errors.push(`missing required field '${field}' for ${discriminator}`);
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, entityType: discriminator, id: id as string };
  }
}
