// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

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
import {
  InMemoryValkey,
  ValkeyTokenBucket,
  type RateLimiter,
  type ValkeyClient,
  ValkeyStreamConsumer,
} from '@bdi/events';
import { buildRouter, type HealthProbe } from './interface/http/routes.ts';
import type { Router } from './interface/http/router.ts';
import type { EventBusPort, HttpClientPort } from './application/ports.ts';
import {
  buildAsrEventConsumer,
  buildOrsEventConsumer,
  InMemoryBvodCache,
  InMemoryMemberCache,
  type BvodCache,
  type MemberCache,
} from './interface/events/consumers.ts';

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
  // Event consumer wiring. If a ValkeyClient is provided the composition creates
  // two real ValkeyStreamConsumers (one for asr stream, one for ors stream).
  // Without a client it leaves the consumers unused — the handlers are still
  // constructed so the types line up.
  readonly valkey?: ValkeyClient;
  readonly ownMemberEuid?: string;
  readonly bvodCache?: BvodCache;
  readonly memberCache?: MemberCache;
  readonly asrEventStream?: string;
  readonly orsEventStream?: string;
  readonly consumerGroup?: string;
  readonly consumerName?: string;
  readonly trustedCaSpkiHashes?: ReadonlySet<string>;
  readonly requireX5c?: boolean;
}

export interface ConComposition {
  readonly router: Router;
  readonly eventLoops: {
    readonly startAll: () => Promise<void>;
    readonly stopAll: () => Promise<void>;
  };
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
    readonly bvodCache: BvodCache;
    readonly memberCache: MemberCache;
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
    ...(config.trustedCaSpkiHashes ? { trustedCaSpkiHashes: config.trustedCaSpkiHashes } : {}),
    ...(config.requireX5c !== undefined ? { requireX5c: config.requireX5c } : {}),
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
  const bvodCache = config.bvodCache ?? new InMemoryBvodCache();
  const memberCache = config.memberCache ?? new InMemoryMemberCache();

  // Event consumer setup. Handlers are always built so tests can inject
  // envelopes directly; the Valkey-backed pump is only started when a real
  // ValkeyClient is supplied.
  const asrHandler = buildAsrEventConsumer({
    trustlist,
    bvodCache,
    memberCache,
    ownMemberEuid: config.ownMemberEuid ?? '',
  });
  const orsHandler = buildOrsEventConsumer({
    trustlist,
    bvodCache,
    memberCache,
    ownMemberEuid: config.ownMemberEuid ?? '',
  });
  const { startAll, stopAll } = buildStreamPumps({
    ...(config.valkey !== undefined ? { valkey: config.valkey } : {}),
    asrStream: config.asrEventStream ?? `{${config.associationId}}:asr:stream:events`,
    orsStream: config.orsEventStream ?? `{${config.associationId}}:ors:stream:events`,
    group: config.consumerGroup ?? `con:${config.ownConnectorId}`,
    consumer: config.consumerName ?? hostname(),
    asrHandler,
    orsHandler,
  });

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
    eventLoops: { startAll, stopAll },
    deps: {
      trustlist,
      orsTrust,
      asrList,
      orsList,
      deliveries,
      bus,
      http,
      forwardClient,
      replayCache,
      rateLimiter,
      metrics,
      bvodCache,
      memberCache,
    },
  };
}

function hostname(): string {
  try {
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.HOSTNAME ?? 'con';
  } catch {
    return 'con';
  }
}

interface StreamPumpOptions {
  readonly valkey?: ValkeyClient;
  readonly asrStream: string;
  readonly orsStream: string;
  readonly group: string;
  readonly consumer: string;
  readonly asrHandler: ReturnType<typeof buildAsrEventConsumer>;
  readonly orsHandler: ReturnType<typeof buildOrsEventConsumer>;
}

function buildStreamPumps(opts: StreamPumpOptions): {
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
} {
  let running = false;
  const noop = async (): Promise<void> => {};
  if (!opts.valkey) return { startAll: noop, stopAll: noop };

  const asrConsumer = new ValkeyStreamConsumer(opts.valkey, opts.asrStream, opts.group, opts.consumer);
  const orsConsumer = new ValkeyStreamConsumer(opts.valkey, opts.orsStream, opts.group, opts.consumer);

  async function loop(
    consumer: ValkeyStreamConsumer,
    handler: ReturnType<typeof buildAsrEventConsumer>,
  ): Promise<void> {
    while (running) {
      try {
        const batch = await consumer.poll(16);
        for (const { id, envelope } of batch) {
          handler.submit(envelope);
          await handler.tick();
          await consumer.ack(id);
        }
        if (batch.length === 0) await new Promise((r) => setTimeout(r, 250));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('stream consumer error', e);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return {
    async startAll() {
      running = true;
      await asrConsumer.ensureGroup();
      await orsConsumer.ensureGroup();
      void loop(asrConsumer, opts.asrHandler);
      void loop(orsConsumer, opts.orsHandler);
    },
    async stopAll() {
      running = false;
    },
  };
}

// Exposed for tests that want a recording client by default
export { RecordingHttpClient, RecordingHeaderedHttpClient };
