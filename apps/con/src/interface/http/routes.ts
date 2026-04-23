// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { Router, type HttpRequest, type HttpResponse } from './router.ts';
import type { VerifyIncomingUseCase } from '../../application/use-cases/verify-incoming.ts';
import type { DeliverWebhookUseCase } from '../../application/use-cases/deliver-webhook.ts';
import type { ReceiveWebhookUseCase } from '../../application/use-cases/receive-webhook.ts';
import type { ProxyForwardUseCase } from '../../application/use-cases/proxy-forward.ts';
import type { DeliveryRepository } from '../../application/ports.ts';
import type { WebhookDelivery } from '../../domain/webhook.ts';

export interface RateLimiterPort {
  allow(key: string): Promise<boolean>;
}

export interface HealthProbe {
  check(): Promise<{ ok: boolean; detail?: string }>;
}

export interface MetricsRenderer {
  render(): string;
}

export interface RouterDeps {
  readonly verifyIncoming: VerifyIncomingUseCase;
  readonly deliverWebhook: DeliverWebhookUseCase;
  readonly receiveWebhook: ReceiveWebhookUseCase;
  readonly proxyForward: ProxyForwardUseCase;
  readonly deliveries: DeliveryRepository;
  readonly rateLimiter: RateLimiterPort;
  readonly idGenerator: () => string;
  readonly nowIso: () => string;
  readonly readinessProbes?: ReadonlyArray<HealthProbe>;
  readonly startupProbes?: ReadonlyArray<HealthProbe>;
  readonly metrics?: MetricsRenderer;
}

export function buildRouter(deps: RouterDeps): Router {
  const router = new Router();

  router.get('/health/live', async () => json(200, { status: 'ok' }));
  router.get('/health/ready', async () => {
    const results = await runProbes(deps.readinessProbes ?? []);
    return results.ok
      ? json(200, { status: 'ready', checks: results.checks })
      : json(503, { status: 'not-ready', checks: results.checks });
  });
  router.get('/health/startup', async () => {
    const results = await runProbes(deps.startupProbes ?? []);
    return results.ok
      ? json(200, { status: 'started', checks: results.checks })
      : json(503, { status: 'starting', checks: results.checks });
  });

  router.get('/metrics', async () => {
    if (!deps.metrics) return { status: 200, body: '# no metrics\n', headers: { 'content-type': 'text/plain' } };
    return { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' }, body: deps.metrics.render() };
  });

  // Data-plane verification — a gateway endpoint stands in for what would be
  // reverse-proxy middleware. Callers supply the BVAD + BVOD via headers and
  // describe the action/resource pair they're attempting.
  router.post('/proxy/check', async (req) => {
    const rlKey = req.headers['x-client-id'] ?? req.headers['authorization'] ?? 'anonymous';
    if (!(await deps.rateLimiter.allow(`proxy:${rlKey}`))) {
      return json(429, { error: 'rate-limited' });
    }
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const bvad =
      typeof body.bvad === 'string'
        ? body.bvad
        : req.headers['authorization']?.replace(/^Bearer\s+/, '') ?? null;
    const bvod = typeof body.bvod === 'string' ? body.bvod : req.headers['x-bdi-context'] ?? null;
    const action = typeof body.action === 'string' ? body.action : 'read';
    const resource =
      body.resource && typeof body.resource === 'object'
        ? (body.resource as { type: string; id: string; tags?: Record<string, string> })
        : { type: 'unknown', id: 'unknown' };

    const r = await deps.verifyIncoming.execute({ bvad, bvod, action, resource });
    if (!r.ok) {
      const status = statusForVerifyError(r.error.type);
      return json(status, { error: r.error.type, reason: (r.error as { reason?: string }).reason });
    }
    return json(200, { ok: true, subject: r.value.bvad.sub });
  });

  // Actual reverse-proxy: forward everything under /proxy/* to the configured
  // upstream after full verification. Method and body are preserved.
  const proxyHandler = async (req: HttpRequest): Promise<HttpResponse> => {
    const rlKey = req.headers['x-client-id'] ?? req.headers['authorization'] ?? 'anonymous';
    if (!(await deps.rateLimiter.allow(`proxy:${rlKey}`))) {
      return json(429, { error: 'rate-limited' });
    }
    const bvad = req.headers['authorization']?.replace(/^Bearer\s+/, '') ?? null;
    const bvod = req.headers['x-bdi-context'] ?? null;
    const action = req.headers['x-bdi-action'] ?? `${req.method.toLowerCase()}:resource`;
    const resourceHeader = req.headers['x-bdi-resource'];
    const resource = resourceHeader
      ? (JSON.parse(resourceHeader) as { type: string; id: string; tags?: Record<string, string> })
      : { type: 'proxy', id: req.path };
    const clientCertThumb = req.headers['x-client-cert-thumbprint'];

    const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const r = await deps.proxyForward.execute({
      method: req.method,
      path: stripProxyPrefix(req.path),
      headers: req.headers,
      body: bodyString,
      bvad,
      bvod,
      action,
      resource,
      ...(clientCertThumb !== undefined ? { clientCertThumbprint: clientCertThumb } : {}),
    });
    if (!r.ok) {
      const status = statusForProxyError(r.error.type);
      return json(status, { error: r.error.type });
    }
    return { status: r.value.status, headers: r.value.headers, body: r.value.body };
  };
  router.get('/proxy-upstream/*', proxyHandler);
  router.post('/proxy-upstream/*', proxyHandler);
  router.put('/proxy-upstream/*', proxyHandler);
  router.delete('/proxy-upstream/*', proxyHandler);

  router.post('/webhooks/outbound', async (req) => {
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const url = typeof body.target_url === 'string' ? body.target_url : null;
    const eventId = typeof body.event_id === 'string' ? body.event_id : null;
    const eventType = typeof body.event_type === 'string' ? body.event_type : null;
    const payload = body.payload;
    if (!url || !eventId || !eventType) return json(400, { error: 'bad-input' });
    const delivery: WebhookDelivery = {
      id: deps.idGenerator(),
      direction: 'outbound',
      target_url: url,
      event_id: eventId,
      event_type: eventType,
      attempts: 0,
      status: 'pending',
      last_http_status: null,
      last_error: null,
      created_at: deps.nowIso(),
      completed_at: null,
      body: JSON.stringify(payload ?? {}),
    };
    await deps.deliveries.save(delivery);
    const r = await deps.deliverWebhook.execute({ delivery });
    if (!r.ok) return json(500, { error: 'internal' });
    return json(202, { delivery_id: delivery.id, state: r.value.state });
  });

  router.get('/webhooks/deliveries/:id', async (req) => {
    const d = await deps.deliveries.find(req.params.id!);
    if (!d) return json(404, { error: 'not-found' });
    return json(200, d);
  });

  router.get('/webhooks/deliveries', async () => {
    const pending = await deps.deliveries.listPending();
    const dead = await deps.deliveries.listDead();
    return json(200, { pending, dead });
  });

  router.post('/webhooks/inbound', async (req) => {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const jws = req.headers['bdi-signature'] ?? '';
    const eventId = req.headers['bdi-event-id'] ?? '';
    const eventType = req.headers['bdi-event-type'] ?? '';
    const issuer = req.headers['bdi-issuer'] ?? '';
    const r = await deps.receiveWebhook.execute({ jws, eventId, eventType, issuer, body });
    if (!r.ok) {
      const status =
        r.error.type === 'signature-invalid' || r.error.type === 'missing-headers'
          ? 400
          : r.error.type === 'issuer-not-allowed'
            ? 403
            : r.error.type === 'replay-detected'
              ? 409
              : 400;
      return json(status, { error: r.error.type });
    }
    return json(202, { accepted: true, event_id: eventId });
  });

  return router;
}

function statusForVerifyError(type: string): number {
  switch (type) {
    case 'bvad-missing':
    case 'bvod-missing':
      return 401;
    case 'bvad-invalid':
    case 'bvod-invalid':
      return 401;
    case 'bvad-rejected':
    case 'bvod-rejected':
      return 401;
    case 'policy-denied':
      return 403;
    default:
      return 400;
  }
}

function statusForProxyError(type: string): number {
  switch (type) {
    case 'no-matching-upstream':
      return 404;
    case 'verify-failed':
      return 401;
    case 'mtls-required':
    case 'mtls-mismatch':
      return 401;
    case 'upstream-failure':
      return 502;
    default:
      return 500;
  }
}

function stripProxyPrefix(path: string): string {
  return path.startsWith('/proxy-upstream')
    ? path.slice('/proxy-upstream'.length) || '/'
    : path;
}

async function runProbes(
  probes: ReadonlyArray<HealthProbe>,
): Promise<{ ok: boolean; checks: ReadonlyArray<{ ok: boolean; detail?: string }> }> {
  const results = await Promise.all(probes.map(async (p) => p.check()));
  return { ok: results.every((r) => r.ok), checks: results };
}

function json(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

export function toHttpRequest(req: Request, bodyJson: unknown): HttpRequest {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => void (headers[k] = v));
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => void (query[k] = v));
  return {
    method: req.method as HttpRequest['method'],
    path: url.pathname,
    headers,
    query,
    body: bodyJson,
    params: {},
  };
}
