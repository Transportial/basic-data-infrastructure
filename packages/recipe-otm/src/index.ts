// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export { composeOtmRecipe } from './recipe.ts';
export type { OtmRecipe } from './recipe.ts';
export { OtmPayloadInspector, OTM_CONTENT_TYPE } from './inspector.ts';
export type { OtmInspectorOptions } from './inspector.ts';
export { MinimalOtmValidator } from './validator.ts';
export type { OtmValidator, OtmValidationOk, OtmValidationErr, OtmValidationResult } from './validator.ts';
export {
  OTM_VERSION,
  OTM_DISCRIMINATOR,
  OTM_ENTITY_TYPES,
  OTM_REQUIRED_FIELDS,
  isKnownOtmEntityType,
} from './schemas/otm-5.8.ts';
export type { OtmEntityType } from './schemas/otm-5.8.ts';
