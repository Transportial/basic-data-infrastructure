// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// A verification source that always reports success — lets the E2E harness
// drive the full ASR onboarding flow (start → run-verifications → approve)
// without standing up KvK/VIES fakes.

export type VerificationSourceName = 'KvK' | 'KBO' | 'GLEIF' | 'VIES';

export class AlwaysSuccessfulVerificationSource {
  constructor(public readonly name: VerificationSourceName) {}

  async verify(): Promise<{ outcome: 'success'; evidence_hash: string }> {
    return { outcome: 'success', evidence_hash: await sha256Hex(`${this.name}-ok`) };
  }
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
