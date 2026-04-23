// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { IdPort } from '../application/ports.ts';

export class SystemUuidIds implements IdPort {
  newUuid(): string {
    return crypto.randomUUID();
  }
}
