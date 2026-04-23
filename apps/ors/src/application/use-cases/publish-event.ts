// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type ChainContextId, type Euid, type Result } from '@bdi/kernel';
import { effectiveRoles, isParty } from '../../domain/model/context-transitions.ts';
import type {
  ChainContextRepository,
  ClockPort,
  EventBusPort,
  SubscriptionRepository,
} from '../ports.ts';

export type PublishEventError =
  | { type: 'context-not-found'; id: ChainContextId }
  | { type: 'not-involved'; euid: Euid };

export interface PublishEventInput {
  readonly chain_context_id: ChainContextId;
  readonly publisher: Euid;
  readonly event_type: string;
  readonly payload: unknown;
}

export interface PublishEventOutput {
  readonly deliveries: ReadonlyArray<{ subscription_id: string; callback_url: string }>;
}

export class PublishContextEventUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly subs: SubscriptionRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: PublishEventInput,
  ): Promise<Result<PublishEventOutput, PublishEventError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (!isParty(ctx, input.publisher)) return err({ type: 'not-involved', euid: input.publisher });

    // Authorisation — effective roles must include a 'publish:event' scope
    // derivation, else ignore. For the reference implementation we accept any
    // party role; production deployments can tighten this with the PDP.
    void effectiveRoles(ctx, input.publisher);

    const subs = (await this.subs.listByContext(ctx.id)).filter(
      (s) => s.active && s.event_types.includes(input.event_type),
    );
    const deliveries = subs.map((s) => ({
      subscription_id: s.id,
      callback_url: s.callback_url,
    }));

    await this.bus.publish('ors.context.event-occurred', ctx.association_id, {
      chain_context_id: ctx.id,
      event_type: input.event_type,
      publisher: input.publisher,
      occurred_at: this.clock.nowIso(),
      payload: input.payload,
      deliveries,
    });

    return ok({ deliveries });
  }
}
