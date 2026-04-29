// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { IdPort } from '../application/ports.ts';

export class SystemUuidIds implements IdPort {
  newUuid(): string {
    return crypto.randomUUID();
  }
}
