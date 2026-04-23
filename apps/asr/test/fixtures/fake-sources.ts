// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { VerificationSource } from '../../src/application/ports.ts';
import { sha256Hex } from '../../src/infrastructure/verification-sources.ts';

export class AlwaysSuccessSource implements VerificationSource {
  constructor(public readonly name: VerificationSource['name']) {}
  async verify(): Promise<{ outcome: 'success'; evidence_hash: string }> {
    return { outcome: 'success', evidence_hash: await sha256Hex(`${this.name}-ok`) };
  }
}

export class AlwaysFailureSource implements VerificationSource {
  constructor(public readonly name: VerificationSource['name']) {}
  async verify(): Promise<{ outcome: 'failure'; evidence_hash: string }> {
    return { outcome: 'failure', evidence_hash: await sha256Hex(`${this.name}-fail`) };
  }
}
