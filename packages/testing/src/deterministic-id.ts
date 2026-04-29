// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export interface IdGenerator {
  next(): string;
}

export class DeterministicIds implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix: string = 'id') {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
  reset(): void {
    this.n = 0;
  }
}

export class DeterministicUuidGenerator implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    const hex = this.n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }
  reset(): void {
    this.n = 0;
  }
}
