// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Hot-reloadable config with atomic swap semantics. Callers construct a
// `HotConfig` with an initial value and a reload function that returns a new
// value on SIGHUP. Consumers read via `current()` and never store stale
// references — the swap is atomic at the Reference level.

export type Reloader<T> = () => Promise<T>;

export class HotConfig<T> {
  private value: T;
  private readonly listeners = new Set<(value: T) => void>();
  private detach: (() => void) | null = null;

  constructor(
    initial: T,
    private readonly reloader: Reloader<T>,
  ) {
    this.value = initial;
  }

  current(): T {
    return this.value;
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async reload(): Promise<T> {
    const next = await this.reloader();
    this.value = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  bindToSignal(signal: 'SIGHUP' | 'SIGUSR1' | 'SIGUSR2' = 'SIGHUP'): void {
    const proc = (globalThis as { process?: NodeJS.Process }).process;
    if (!proc || typeof proc.on !== 'function') return;
    const handler = (): void => {
      this.reload().catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[hot-config] reload on ${signal} failed`, e);
      });
    };
    proc.on(signal, handler);
    this.detach = () => {
      (proc as NodeJS.Process & { off?: (s: string, h: () => void) => void }).off?.(signal, handler);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.listeners.clear();
  }
}
