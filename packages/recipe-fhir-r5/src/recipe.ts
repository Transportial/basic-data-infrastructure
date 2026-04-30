// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PayloadInspectorPort } from '@transportial/con';
import { FhirR5PayloadInspector, type FhirR5InspectorOptions } from './inspector.ts';

// composeFhirR5Recipe is the single entry point a connector deployment uses
// to install the FHIR R5 recipe. Today it returns just the inspector hook;
// the same shape is the seam for future recipe artefacts (default policies,
// FHIR-aware audit hooks, profile validators, ...).
export interface FhirR5Recipe {
  readonly inspectors: ReadonlyArray<PayloadInspectorPort>;
}

export function composeFhirR5Recipe(options: FhirR5InspectorOptions = {}): FhirR5Recipe {
  return {
    inspectors: [new FhirR5PayloadInspector(options)],
  };
}
