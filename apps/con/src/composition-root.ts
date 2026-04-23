// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { SystemClock } from '@bdi/kernel';
import { InMemoryTrustlist } from '@bdi/crypto';
import { EmbeddedPdp, type Policy } from '@bdi/policy';
import { MetricsRegistry } from '@bdi/observability';
import { TrustlistStore } from './infrastructure/trustlist-store.ts';
import { OrsTrust } from './infrastructure/ors-trust.ts';
import { FetchHttpClient, RecordingHttpClient } from './infrastructure/http-client.ts';
import {
  FetchHeaderedHttpClient,
  RecordingHeaderedHttpClient,
} from './infrastructure/http-forward.ts';
import { InMemoryDeliveryRepository } from './infrastructure/delivery-repository.ts';
import { VerifyIncomingUseCase } from './application/use-cases/verify-incoming.ts';
import { DeliverWebhookUseCase } from './application/use-cases/deliver-webhook.ts';
import {
  InMemoryReplayCache,
  ReceiveWebhookUseCase,
  type ReplayCache,
} from './application/use-cases/receive-webhook.ts';
import {
  ProxyForwardUseCase,
  type UpstreamRoute,
  type HeaderedHttpClient,
} from './application/use-cases/proxy-forward.ts';
import { InMemoryValkey, ValkeyTokenBucket, type RateLimiter } from '@bdi/events';
import { buildRouter, type HealthProbe } from './interface/http/routes.ts';
import type { Router } from './interface/http/router.ts';
import type { EventBusPort, HttpClientPort } from './application/ports.ts';

export class InMemoryEventBus implements EventBusPort {
  readonly published: Array<{ type: string; associationId: string; body: unknown }> = [];
  async publish(type: string, associationId: string, body: unknown): Promise<void> {
    this.published.push({ type, associationId, body });
  }
  clear(): void {
    this.published.length = 0;
  }
}

export interface ConConfig {
  readonly asrIssuer: string;
  readonly orsIssuer: string;
  readonly associationId: string;
  readonly ownConnectorId: string;
  readonly audience: string;
  readonly policies?: ReadonlyArray<Policy>;
  readonly asrTrustlist?: InMemoryTrustlist;
  readonly orsTrustlist?: InMemoryTrustlist;
  readonly httpClient?: HttpClientPort;
  readonly allowedIssuers?: ReadonlyArray<string>;
  readonly replayCache?: ReplayCache;
  readonly rateLimiter?: RateLimiter;
  readonly rateLimit?: { limit: number; windowMs: number };
  readonly upstreams?: ReadonlyArray<UpstreamRoute>;
  readonly forwardClient?: HeaderedHttpClient;
  readonly metrics?: MetricsRegistry;
  readonly readinessProbes?: ReadonlyArray<HealthProbe>;
  readonly startupProbes?: ReadonlyArray<HealthProbe>;
}

export interface ConComposition {
  readonly router: Router;
  readonly deps: {
    readonly trustlist: TrustlistStore;
    readonly orsTrust: OrsTrust;
    readonly asrList: InMemoryTrustlist;
    readonly orsList: InMemoryTrustlist;
    readonly deliveries: InMemoryDeliveryRepository;
    readonly bus: InMemoryEventBus;
    readonly http: HttpClientPort;
    readonly forwardClient: HeaderedHttpClient;
    readonly replayCache: ReplayCache;
    readonly rateLimiter: RateLimiter;
    readonly metrics: MetricsRegistry;
  };
}

// Minimal default policy set — refuse everything unless status=active and
// minimum assurance 'substantial'. Operators swap in a richer policy set via
// config.
const DEFAULT_POLICIES: ReadonlyArray<Policy> = [
  {
    id: 'permit-active',
    effect: 'permit',
    actions: '*',
    resourceTypes: '*',
    when: (i) => i.subject.status === 'active',
  },
  {
    id: 'forbid-non-active',
    effect: 'forbid',
    actions: '*',
    when: (i) => i.subject.status !== 'active',
  },
];

export function composeCon(config: ConConfig): ConComposition {
  const clock = new SystemClock();
  const bus = new InMemoryEventBus();
  const asrList = config.asrTrustlist ?? new InMemoryTrustlist();
  const orsList = config.orsTrustlist ?? new InMemoryTrustlist();
  const trustlist = new TrustlistStore(asrList);
  const orsTrust = new OrsTrust(orsList);
  const pdp = new EmbeddedPdp(config.policies ?? DEFAULT_POLICIES);
  const deliveries = new InMemoryDeliveryRepository();
  const http = config.httpClient ?? new FetchHttpClient();
  const replayCache = config.replayCache ?? new InMemoryReplayCache();
  const rateLimiter =
    config.rateLimiter ??
    new ValkeyTokenBucket(new InMemoryValkey(), {
      limit: config.rateLimit?.limit ?? 1000,
      windowMs: config.rateLimit?.windowMs ?? 60_000,
      prefix: 'con:rl:',
    });

  const verifyIncoming = new VerifyIncomingUseCase(trustlist, orsTrust, pdp, clock, {
    asrIssuer: config.asrIssuer,
    orsIssuer: config.orsIssuer,
    ownConnectorId: config.ownConnectorId,
    associationId: config.associationId,
    audience: config.audience,
  });
  const deliverWebhook = new DeliverWebhookUseCase(http, deliveries, bus, clock, {
    associationId: config.associationId,
    rand: () => 0.5,
  });
  const receiveWebhook = new ReceiveWebhookUseCase(
    asrList,
    replayCache,
    clock,
    bus,
    {
      allowedIssuers:
        config.allowedIssuers ?? [config.asrIssuer, config.orsIssuer],
    },
    config.associationId,
  );
  const forwardClient = config.forwardClient ?? new FetchHeaderedHttpClient();
  const proxyForward = new ProxyForwardUseCase(verifyIncoming, forwardClient, {
    routes: config.upstreams ?? [],
    stripBdiHeaders: true,
  });
  const metrics = config.metrics ?? new MetricsRegistry();

  const router = buildRouter({
    verifyIncoming,
    deliverWebhook,
    receiveWebhook,
    proxyForward,
    deliveries,
    rateLimiter,
    idGenerator: () => crypto.randomUUID(),
    nowIso: () => clock.nowIso(),
    ...(config.readinessProbes !== undefined ? { readinessProbes: config.readinessProbes } : {}),
    ...(config.startupProbes !== undefined ? { startupProbes: config.startupProbes } : {}),
    metrics,
  });

  return {
    router,
    deps: { trustlist, orsTrust, asrList, orsList, deliveries, bus, http, forwardClient, replayCache, rateLimiter, metrics },
  };
}

// Exposed for tests that want a recording client by default
export { RecordingHttpClient, RecordingHeaderedHttpClient };
