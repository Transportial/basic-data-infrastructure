// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { AssociationId, ChainContextId, ClockPort, Euid } from '@bdi/kernel';
import type { ChainContext } from '../domain/model/chain-context.ts';
import type { Subscription } from '../domain/model/subscription.ts';

export interface ChainContextRepository {
  save(ctx: ChainContext): Promise<void>;
  find(id: ChainContextId): Promise<ChainContext | null>;
  listByOrchestrator(orchestrator: Euid): Promise<ReadonlyArray<ChainContext>>;
  listByParty(euid: Euid): Promise<ReadonlyArray<ChainContext>>;
  listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<ChainContext>>;
}

export interface SubscriptionRepository {
  save(subscription: Subscription): Promise<void>;
  find(id: string): Promise<Subscription | null>;
  listByContext(id: ChainContextId): Promise<ReadonlyArray<Subscription>>;
  listBySubscriber(euid: Euid): Promise<ReadonlyArray<Subscription>>;
}

export interface IdPort {
  newUuid(): string;
}

export interface EventBusPort {
  publish(type: string, associationId: string, body: unknown): Promise<void>;
}

export interface SignerPort {
  signJwt(claims: unknown): Promise<string>;
  readonly kid: string;
}

export interface ConnectorLookupPort {
  // Looks up allowed callback URLs for a connector so subscriptions can't be
  // made to arbitrary endpoints. The ASR is the authoritative source via
  // trustlist events; ORS caches the needed subset.
  listCallbacks(connectorId: string): Promise<ReadonlyArray<string>>;
}

export type { ClockPort };
