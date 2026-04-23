// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

export type Labels = Readonly<Record<string, string>>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

export class Counter {
  private readonly values = new Map<string, number>();
  private readonly labelStores = new Map<string, Labels>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, amount = 1): void {
    if (amount < 0) throw new RangeError('counter cannot decrement');
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + amount);
    if (!this.labelStores.has(k)) this.labelStores.set(k, labels);
  }

  value(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  reset(): void {
    this.values.clear();
    this.labelStores.clear();
  }

  snapshot(): Array<{ labels: Labels; value: number }> {
    return [...this.values.entries()].map(([k, v]) => ({
      labels: this.labelStores.get(k) ?? {},
      value: v,
    }));
  }
}

export class Histogram {
  private readonly buckets: number[];
  private readonly data = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();

  constructor(
    readonly name: string,
    readonly help: string,
    buckets?: number[],
  ) {
    this.buckets = (buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]).slice();
  }

  observe(value: number, labels: Labels = {}): void {
    const k = labelKey(labels);
    let entry = this.data.get(k);
    if (!entry) {
      entry = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.data.set(k, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= (this.buckets[i] as number)) entry.counts[i] = (entry.counts[i] ?? 0) + 1;
    }
  }

  snapshot(labels: Labels = {}): {
    buckets: ReadonlyArray<{ le: number; count: number }>;
    sum: number;
    count: number;
  } | null {
    const entry = this.data.get(labelKey(labels));
    if (!entry) return null;
    return {
      buckets: this.buckets.map((le, i) => ({ le, count: entry.counts[i] ?? 0 })),
      sum: entry.sum,
      count: entry.count,
    };
  }

  reset(): void {
    this.data.clear();
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, help: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  render(): string {
    const lines: string[] = [];
    for (const c of this.counters.values()) {
      lines.push(`# HELP ${c.name} ${c.help}`);
      lines.push(`# TYPE ${c.name} counter`);
      for (const s of c.snapshot()) {
        const labels = renderLabels(s.labels);
        lines.push(`${c.name}${labels} ${s.value}`);
      }
    }
    for (const h of this.histograms.values()) {
      lines.push(`# HELP ${h.name} ${h.help}`);
      lines.push(`# TYPE ${h.name} histogram`);
      // snapshot only renders explicitly-known label sets
    }
    return lines.join('\n') + '\n';
  }
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k] ?? '')}"`).join(',')}}`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
