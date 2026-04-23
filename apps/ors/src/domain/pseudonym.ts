// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Euid } from '@bdi/kernel';

// Generate a pseudonym for a natural person tied to an organisation, a person
// identifier supplied by the organisation, and a per-association salt. The
// pseudonym is deterministic (same person in the same chain produces the same
// pseudonym), so reputation and repeat involvement can be tracked, but
// indistinguishable to other associations that don't know the salt.
export async function pseudonymise(
  organisation: Euid,
  personRef: string,
  salt: string,
): Promise<string> {
  const input = `${organisation}|${personRef}|${salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
