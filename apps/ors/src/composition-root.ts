// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { SystemClock } from '@bdi/kernel';
import { CreateChainContextUseCase } from './application/use-cases/create-chain-context.ts';
import {
  AddDelegationUseCase,
  AddPartyUseCase,
  RemovePartyUseCase,
} from './application/use-cases/manage-parties.ts';
import { IssueBvodUseCase } from './application/use-cases/issue-bvod.ts';
import { SubscribeUseCase } from './application/use-cases/subscribe.ts';
import { PublishContextEventUseCase } from './application/use-cases/publish-event.ts';
import {
  InMemoryChainContextRepository,
  InMemorySubscriptionRepository,
} from './infrastructure/repositories/in-memory.ts';
import { InMemoryConnectorLookup } from './infrastructure/connector-lookup.ts';
import { JwsSigner, randomSigningKey } from './infrastructure/crypto/signer.ts';
import { SystemUuidIds } from './infrastructure/id-port.ts';
import { buildRouter } from './interface/http/routes.ts';
import type { Router } from './interface/http/router.ts';
import type { EventBusPort } from './application/ports.ts';

export class InMemoryEventBus implements EventBusPort {
  readonly published: Array<{ type: string; associationId: string; body: unknown }> = [];
  async publish(type: string, associationId: string, body: unknown): Promise<void> {
    this.published.push({ type, associationId, body });
  }
  clear(): void {
    this.published.length = 0;
  }
}

export interface OrsConfig {
  readonly issuer: string;
  readonly signingKid?: string;
  readonly signingKey?: Uint8Array;
}

export interface OrsComposition {
  readonly router: Router;
  readonly deps: {
    readonly contexts: InMemoryChainContextRepository;
    readonly subscriptions: InMemorySubscriptionRepository;
    readonly connectors: InMemoryConnectorLookup;
    readonly signer: JwsSigner;
    readonly bus: InMemoryEventBus;
  };
}

export function composeOrs(config: OrsConfig): OrsComposition {
  const clock = new SystemClock();
  const ids = new SystemUuidIds();
  const bus = new InMemoryEventBus();
  const signer = new JwsSigner({
    kid: config.signingKid ?? 'ors-2026-01',
    key: config.signingKey ?? randomSigningKey(),
  });

  const contexts = new InMemoryChainContextRepository();
  const subscriptions = new InMemorySubscriptionRepository();
  const connectors = new InMemoryConnectorLookup();

  const createChainContext = new CreateChainContextUseCase(contexts, ids, clock, bus);
  const addParty = new AddPartyUseCase(contexts, clock, bus);
  const removeParty = new RemovePartyUseCase(contexts, bus);
  const addDelegation = new AddDelegationUseCase(contexts, clock, bus);
  const issueBvod = new IssueBvodUseCase(contexts, signer, clock, ids, bus, {
    issuer: config.issuer,
  });
  const subscribe = new SubscribeUseCase(contexts, subscriptions, connectors, ids, clock, bus);
  const publishEvent = new PublishContextEventUseCase(contexts, subscriptions, clock, bus);

  const router = buildRouter({
    createChainContext,
    addParty,
    removeParty,
    addDelegation,
    issueBvod,
    subscribe,
    publishEvent,
    contexts,
  });

  return { router, deps: { contexts, subscriptions, connectors, signer, bus } };
}
