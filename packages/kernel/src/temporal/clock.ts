// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

export interface ClockPort {
  nowIso(): string;
  nowUnix(): number;
  nowMillis(): number;
}

export class SystemClock implements ClockPort {
  nowIso(): string {
    return new Date().toISOString();
  }
  nowUnix(): number {
    return Math.floor(Date.now() / 1000);
  }
  nowMillis(): number {
    return Date.now();
  }
}

export class FakeClock implements ClockPort {
  private current: number;

  constructor(initial: string | number | Date = '2026-04-23T10:00:00.000Z') {
    this.current =
      initial instanceof Date
        ? initial.getTime()
        : typeof initial === 'number'
          ? initial
          : new Date(initial).getTime();
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  nowUnix(): number {
    return Math.floor(this.current / 1000);
  }

  nowMillis(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(at: string | number | Date): void {
    this.current =
      at instanceof Date ? at.getTime() : typeof at === 'number' ? at : new Date(at).getTime();
  }
}
