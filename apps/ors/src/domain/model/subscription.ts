// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type ChainContextId, type ConnectorId, type Euid, type Result } from '@bdi/kernel';

export interface Subscription {
  readonly id: string;
  readonly chain_context_id: ChainContextId;
  readonly subscriber_euid: Euid;
  readonly subscriber_connector_id: ConnectorId;
  readonly event_types: ReadonlyArray<string>;
  readonly callback_url: string;
  readonly active: boolean;
  readonly created_at: string;
}

export type SubscriptionError =
  | { type: 'bad-callback-url'; url: string }
  | { type: 'empty-event-types' };

export function validateSubscription(input: {
  id: string;
  chain_context_id: ChainContextId;
  subscriber_euid: Euid;
  subscriber_connector_id: ConnectorId;
  event_types: ReadonlyArray<string>;
  callback_url: string;
  allowedCallbacks: ReadonlyArray<string>;
  created_at: string;
}): Result<Subscription, SubscriptionError> {
  if (input.event_types.length === 0) return err({ type: 'empty-event-types' });
  if (!input.allowedCallbacks.includes(input.callback_url)) {
    return err({ type: 'bad-callback-url', url: input.callback_url });
  }
  return ok({
    id: input.id,
    chain_context_id: input.chain_context_id,
    subscriber_euid: input.subscriber_euid,
    subscriber_connector_id: input.subscriber_connector_id,
    event_types: input.event_types,
    callback_url: input.callback_url,
    active: true,
    created_at: input.created_at,
  });
}

export function deactivate(sub: Subscription): Subscription {
  return { ...sub, active: false };
}
