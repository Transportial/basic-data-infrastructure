// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PayloadInspectorPort } from '@transportial/contracts';
import { OtmPayloadInspector, type OtmInspectorOptions } from './inspector.ts';

// composeOtmRecipe is the single entry point a connector deployment uses to
// install the OTM recipe. Today it returns just the inspector hook; the same
// shape is the seam for future recipe artefacts (default policies, OTM-aware
// metrics, webhook validators, ...) so callers don't have to learn a new API
// when those land.
export interface OtmRecipe {
  readonly inspectors: ReadonlyArray<PayloadInspectorPort>;
}

export function composeOtmRecipe(options: OtmInspectorOptions = {}): OtmRecipe {
  return {
    inspectors: [new OtmPayloadInspector(options)],
  };
}
