// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { EventEnvelope, Service } from '@bdi/contracts';

export interface EventBus {
  publish<TBody>(type: string, associationId: string, body: TBody): Promise<string>;
}

export interface ProducerOptions {
  readonly service: Service;
  readonly instance: string;
  readonly version: string;
  readonly nowIso: () => string;
  readonly nextId: () => string;
  readonly currentTrace: () => { trace_id: string; span_id: string };
}

export interface EventSink {
  write(envelope: EventEnvelope): Promise<void>;
}

export class InMemoryEventSink implements EventSink {
  readonly envelopes: EventEnvelope[] = [];
  async write(envelope: EventEnvelope): Promise<void> {
    this.envelopes.push(envelope);
  }
  byType<T = unknown>(type: string): EventEnvelope<T>[] {
    return this.envelopes.filter((e) => e.type === type) as EventEnvelope<T>[];
  }
  clear(): void {
    this.envelopes.length = 0;
  }
}

export class EnvelopeProducer implements EventBus {
  constructor(
    private readonly sink: EventSink,
    private readonly options: ProducerOptions,
  ) {}

  async publish<TBody>(type: string, associationId: string, body: TBody): Promise<string> {
    const id = this.options.nextId();
    const envelope: EventEnvelope<TBody> = {
      id,
      occurred_at: this.options.nowIso(),
      producer: {
        service: this.options.service,
        instance: this.options.instance,
        version: this.options.version,
      },
      association_id: associationId,
      type,
      schema_version: 1,
      trace: this.options.currentTrace(),
      body,
    };
    await this.sink.write(envelope);
    return id;
  }
}
