// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { PayloadInspectorPort } from '@transportial/con';
import { MmtRsmPayloadInspector, type MmtRsmInspectorOptions } from './inspector.ts';

// composeMmtRsmRecipe is the single entry point a connector deployment uses
// to install the UN/CEFACT MMT-RSM recipe. Today it returns just the
// inspector hook; the same shape is the seam for future recipe artefacts
// (default policies, customs-aware metrics, gateway validators, ...).
export interface MmtRsmRecipe {
  readonly inspectors: ReadonlyArray<PayloadInspectorPort>;
}

export function composeMmtRsmRecipe(options: MmtRsmInspectorOptions = {}): MmtRsmRecipe {
  return {
    inspectors: [new MmtRsmPayloadInspector(options)],
  };
}
