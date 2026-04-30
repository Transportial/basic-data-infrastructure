// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  FHIR_DISCRIMINATOR,
  FHIR_REQUIRED_FIELDS,
  FHIR_VERSION,
  isKnownFhirResourceType,
  type FhirResourceType,
} from './schemas/fhir-r5.ts';

export interface FhirValidationOk {
  readonly ok: true;
  readonly resourceType: FhirResourceType;
  // FHIR R5 makes `id` optional on create — the server assigns it. The
  // validator therefore returns id only when the payload carries one.
  readonly id?: string;
}

export interface FhirValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type FhirValidationResult = FhirValidationOk | FhirValidationErr;

// FhirR5Validator is the recipe's validation seam. The bundled
// MinimalFhirR5Validator does a structural check against the pinned R5
// resource surface; production users who want full StructureDefinition /
// profile validation can implement this interface against the upstream FHIR
// validator (e.g. fhir.js, hl7-fhir-validator) and inject it into the
// recipe.
export interface FhirR5Validator {
  readonly version: string;
  validate(payload: unknown): FhirValidationResult;
}

// FHIR R5 ids are constrained to up to 64 characters from the set
// [A-Za-z0-9-.] per https://hl7.org/fhir/R5/datatypes.html#id.
const FHIR_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/;

export class MinimalFhirR5Validator implements FhirR5Validator {
  readonly version = FHIR_VERSION;

  validate(payload: unknown): FhirValidationResult {
    const errors: string[] = [];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a JSON object'] };
    }
    const obj = payload as Record<string, unknown>;
    const discriminator = obj[FHIR_DISCRIMINATOR];
    if (!isKnownFhirResourceType(discriminator)) {
      return {
        ok: false,
        errors: [
          `${FHIR_DISCRIMINATOR} must be one of the FHIR R${FHIR_VERSION.split('.')[0]} resource types this recipe transports`,
        ],
      };
    }
    let id: string | undefined;
    if ('id' in obj) {
      const raw = obj['id'];
      if (typeof raw !== 'string' || !FHIR_ID_PATTERN.test(raw)) {
        errors.push('id must match FHIR id pattern [A-Za-z0-9-.]{1,64}');
      } else {
        id = raw;
      }
    }
    for (const field of FHIR_REQUIRED_FIELDS[discriminator]) {
      if (field === FHIR_DISCRIMINATOR) continue;
      if (!(field in obj)) errors.push(`missing required field '${field}' for ${discriminator}`);
    }
    if (errors.length > 0) return { ok: false, errors };
    return id === undefined
      ? { ok: true, resourceType: discriminator }
      : { ok: true, resourceType: discriminator, id };
  }
}
