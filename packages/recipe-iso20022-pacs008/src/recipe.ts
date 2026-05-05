// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PayloadInspectorPort } from '@transportial/contracts';
import { Pacs008PayloadInspector, type Pacs008InspectorOptions } from './inspector.ts';

// composePacs008Recipe is the single entry point a connector deployment
// uses to install the ISO 20022 pacs.008 recipe. Today it returns just the
// inspector hook; the same shape is the seam for future recipe artefacts
// (default policies, settlement-aware metrics, message-id replay guards,
// ...).
export interface Pacs008Recipe {
  readonly inspectors: ReadonlyArray<PayloadInspectorPort>;
}

export function composePacs008Recipe(options: Pacs008InspectorOptions = {}): Pacs008Recipe {
  return {
    inspectors: [new Pacs008PayloadInspector(options)],
  };
}
