// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export { composeEftiRecipe } from './recipe.ts';
export type { EftiRecipe } from './recipe.ts';
export { EftiPayloadInspector, EFTI_CONTENT_TYPE } from './inspector.ts';
export type { EftiInspectorOptions } from './inspector.ts';
export { MinimalEftiValidator } from './validator.ts';
export type {
  EftiValidator,
  EftiValidationOk,
  EftiValidationErr,
  EftiValidationResult,
} from './validator.ts';
export {
  EFTI_VERSION,
  EFTI_DISCRIMINATOR,
  EFTI_ENTITY_TYPES,
  EFTI_REQUIRED_FIELDS,
  isKnownEftiEntityType,
} from './schemas/efti-1.0.ts';
export type { EftiEntityType } from './schemas/efti-1.0.ts';
