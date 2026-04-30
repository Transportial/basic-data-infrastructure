// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export { composeFhirR5Recipe } from './recipe.ts';
export type { FhirR5Recipe } from './recipe.ts';
export { FhirR5PayloadInspector, FHIR_CONTENT_TYPE } from './inspector.ts';
export type { FhirR5InspectorOptions } from './inspector.ts';
export { MinimalFhirR5Validator } from './validator.ts';
export type {
  FhirR5Validator,
  FhirValidationOk,
  FhirValidationErr,
  FhirValidationResult,
} from './validator.ts';
export {
  FHIR_VERSION,
  FHIR_DISCRIMINATOR,
  FHIR_RESOURCE_TYPES,
  FHIR_REQUIRED_FIELDS,
  isKnownFhirResourceType,
} from './schemas/fhir-r5.ts';
export type { FhirResourceType } from './schemas/fhir-r5.ts';
