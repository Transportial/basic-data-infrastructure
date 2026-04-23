// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

export interface PublishedEvent {
  readonly type: string;
  readonly associationId: string;
  readonly body: unknown;
}

export interface EventBusLike {
  publish(type: string, associationId: string, body: unknown): Promise<void>;
}

export class FakeEventBus implements EventBusLike {
  readonly events: PublishedEvent[] = [];

  async publish(type: string, associationId: string, body: unknown): Promise<void> {
    this.events.push({ type, associationId, body });
  }

  clear(): void {
    this.events.length = 0;
  }

  findAllOfType(type: string): PublishedEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  lastOfType(type: string): PublishedEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]?.type === type) return this.events[i];
    }
    return undefined;
  }
}
