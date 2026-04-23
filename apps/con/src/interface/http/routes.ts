// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { Router, type HttpRequest, type HttpResponse } from './router.ts';
import type { VerifyIncomingUseCase } from '../../application/use-cases/verify-incoming.ts';
import type { DeliverWebhookUseCase } from '../../application/use-cases/deliver-webhook.ts';
import type { DeliveryRepository } from '../../application/ports.ts';
import type { WebhookDelivery } from '../../domain/webhook.ts';

export interface RouterDeps {
  readonly verifyIncoming: VerifyIncomingUseCase;
  readonly deliverWebhook: DeliverWebhookUseCase;
  readonly deliveries: DeliveryRepository;
  readonly idGenerator: () => string;
  readonly nowIso: () => string;
}

export function buildRouter(deps: RouterDeps): Router {
  const router = new Router();

  router.get('/health/live', async () => json(200, { status: 'ok' }));
  router.get('/health/ready', async () => json(200, { status: 'ready' }));

  // Data-plane verification — a gateway endpoint stands in for what would be
  // reverse-proxy middleware. Callers supply the BVAD + BVOD via headers and
  // describe the action/resource pair they're attempting.
  router.post('/proxy/check', async (req) => {
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
