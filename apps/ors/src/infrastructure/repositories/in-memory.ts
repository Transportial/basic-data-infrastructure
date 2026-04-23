// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { AssociationId, ChainContextId, Euid } from '@bdi/kernel';
import type { ChainContext } from '../../domain/model/chain-context.ts';
import type { Subscription } from '../../domain/model/subscription.ts';
import type {
  ChainContextRepository,
  SubscriptionRepository,
} from '../../application/ports.ts';

export class InMemoryChainContextRepository implements ChainContextRepository {
  private readonly byId = new Map<ChainContextId, ChainContext>();

  async save(ctx: ChainContext): Promise<void> {
    this.byId.set(ctx.id, ctx);
  }

  async find(id: ChainContextId): Promise<ChainContext | null> {
    return this.byId.get(id) ?? null;
  }

  async listByOrchestrator(orchestrator: Euid): Promise<ReadonlyArray<ChainContext>> {
    return [...this.byId.values()].filter((c) => c.orchestrator_member_id === orchestrator);
  }

  async listByParty(euid: Euid): Promise<ReadonlyArray<ChainContext>> {
    return [...this.byId.values()].filter((c) =>
      c.parties.some((p) => p.member_euid === euid),
    );
  }

  async listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<ChainContext>> {
    return [...this.byId.values()].filter((c) => c.association_id === associationId);
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byId = new Map<string, Subscription>();

  async save(sub: Subscription): Promise<void> {
    this.byId.set(sub.id, sub);
  }

  async find(id: string): Promise<Subscription | null> {
    return this.byId.get(id) ?? null;
  }

  async listByContext(id: ChainContextId): Promise<ReadonlyArray<Subscription>> {
    return [...this.byId.values()].filter((s) => s.chain_context_id === id);
  }

  async listBySubscriber(euid: Euid): Promise<ReadonlyArray<Subscription>> {
    return [...this.byId.values()].filter((s) => s.subscriber_euid === euid);
  }
}
