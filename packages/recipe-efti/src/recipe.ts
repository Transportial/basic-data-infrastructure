// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PayloadInspectorPort } from '@transportial/contracts';
import { EftiPayloadInspector, type EftiInspectorOptions } from './inspector.ts';

// composeEftiRecipe is the single entry point a connector deployment uses to
// install the eFTI recipe. Today it returns just the inspector hook; the same
// shape is the seam for future recipe artefacts (default policies, eFTI-aware
// metrics, gateway validators, ...) so callers don't have to learn a new API
// when those land.
export interface EftiRecipe {
  readonly inspectors: ReadonlyArray<PayloadInspectorPort>;
}

export function composeEftiRecipe(options: EftiInspectorOptions = {}): EftiRecipe {
  return {
    inspectors: [new EftiPayloadInspector(options)],
  };
}
