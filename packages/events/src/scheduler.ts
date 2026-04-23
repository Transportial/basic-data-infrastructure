// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

// A lightweight scheduler for recurring jobs. Jobs can be fired by wall-clock
// intervals or by the `trigger` method (useful for tests or external cron).
// The Scheduler holds no wall-clock state until `start()` is called; that
// makes it cleanly swappable with a BullMQ-based implementation in production.

export interface Job {
  readonly id: string;
  readonly description: string;
  readonly intervalMs: number;
  run(now: Date): Promise<void>;
}

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface SchedulerOptions {
  readonly now?: () => number;
  readonly setTimer?: (cb: () => void, ms: number) => TimerHandle;
  readonly clearTimer?: (id: TimerHandle) => void;
}

export interface RunResult {
  readonly jobId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly success: boolean;
  readonly error?: string;
}

export class Scheduler {
  private readonly jobs = new Map<string, Job>();
  private readonly timers = new Map<string, TimerHandle>();
  readonly history: RunResult[] = [];
  private running = false;

  constructor(private readonly options: SchedulerOptions = {}) {}

  register(job: Job): void {
    if (this.jobs.has(job.id)) throw new Error(`duplicate job id: ${job.id}`);
    this.jobs.set(job.id, job);
    if (this.running) this.scheduleNext(job);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const job of this.jobs.values()) this.scheduleNext(job);
  }

  stop(): void {
    this.running = false;
    for (const [, timer] of this.timers) {
      if (this.options.clearTimer) {
        this.options.clearTimer(timer);
      } else {
        clearTimeout(timer as Parameters<typeof clearTimeout>[0]);
      }
    }
    this.timers.clear();
  }

  async trigger(id: string): Promise<RunResult> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job: ${id}`);
    return this.runJob(job);
  }

  async triggerAll(): Promise<ReadonlyArray<RunResult>> {
    const out: RunResult[] = [];
    for (const j of this.jobs.values()) out.push(await this.runJob(j));
    return out;
  }

  list(): ReadonlyArray<{ id: string; description: string; intervalMs: number }> {
    return [...this.jobs.values()].map((j) => ({
      id: j.id,
      description: j.description,
      intervalMs: j.intervalMs,
    }));
  }

  private scheduleNext(job: Job): void {
    const setTimer = this.options.setTimer ?? setTimeout;
    const timer = setTimer(() => {
      void this.runJob(job).then(() => {
        if (this.running) this.scheduleNext(job);
      });
    }, job.intervalMs);
    this.timers.set(job.id, timer);
  }

  private async runJob(job: Job): Promise<RunResult> {
    const now = this.options.now ?? Date.now;
    const start = new Date(now());
    const startedAt = start.toISOString();
    try {
      await job.run(start);
      const endedAt = new Date(now()).toISOString();
      const result: RunResult = { jobId: job.id, startedAt, endedAt, success: true };
      this.history.push(result);
      return result;
    } catch (e) {
      const endedAt = new Date(now()).toISOString();
      const result: RunResult = {
        jobId: job.id,
        startedAt,
        endedAt,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
      this.history.push(result);
      return result;
    }
  }
}
