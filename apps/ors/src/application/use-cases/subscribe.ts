// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import {
  err,
  ok,
  type ChainContextId,
  type ConnectorId,
  type Euid,
  type Result,
} from '@bdi/kernel';
import { validateSubscription } from '../../domain/model/subscription.ts';
import { isParty } from '../../domain/model/context-transitions.ts';
import type {
  ChainContextRepository,
  ClockPort,
  ConnectorLookupPort,
  EventBusPort,
  IdPort,
  SubscriptionRepository,
} from '../ports.ts';

export type SubscribeError =
  | { type: 'context-not-found'; id: ChainContextId }
  | { type: 'not-involved'; euid: Euid }
  | { type: 'empty-event-types' }
  | { type: 'bad-callback-url'; url: string };

export interface SubscribeInput {
  readonly chain_context_id: ChainContextId;
  readonly subscriber_euid: Euid;
  readonly subscriber_connector_id: ConnectorId;
  readonly event_types: ReadonlyArray<string>;
  readonly callback_url: string;
}

export class SubscribeUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly subs: SubscriptionRepository,
    private readonly connectors: ConnectorLookupPort,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(input: SubscribeInput): Promise<Result<{ subscriptionId: string }, SubscribeError>> {
    const ctx = await this.contexts.find(input.chain_context_id);
    if (!ctx) return err({ type: 'context-not-found', id: input.chain_context_id });
    if (!isParty(ctx, input.subscriber_euid)) {
      return err({ type: 'not-involved', euid: input.subscriber_euid });
    }
    const allowed = await this.connectors.listCallbacks(input.subscriber_connector_id);
    const valid = validateSubscription({
      id: this.ids.newUuid(),
      chain_context_id: input.chain_context_id,
      subscriber_euid: input.subscriber_euid,
      subscriber_connector_id: input.subscriber_connector_id,
      event_types: input.event_types,
      callback_url: input.callback_url,
      allowedCallbacks: allowed,
      created_at: this.clock.nowIso(),
    });
    if (!valid.ok) return err(valid.error);
    await this.subs.save(valid.value);
    await this.bus.publish('ors.subscription.created', ctx.association_id, {
      subscription_id: valid.value.id,
      chain_context_id: ctx.id,
      subscriber: input.subscriber_euid,
    });
    return ok({ subscriptionId: valid.value.id });
  }
}
