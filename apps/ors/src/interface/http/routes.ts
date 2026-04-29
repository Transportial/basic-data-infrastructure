// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  parseAssociationId,
  parseChainContextId,
  parseConnectorId,
  parseEuid,
} from '@transportial/kernel';
import { Router, type HttpRequest, type HttpResponse } from './router.ts';
import type { CreateChainContextUseCase } from '../../application/use-cases/create-chain-context.ts';
import type {
  AddPartyUseCase,
  AddDelegationUseCase,
  RemovePartyUseCase,
} from '../../application/use-cases/manage-parties.ts';
import type { IssueBvodUseCase } from '../../application/use-cases/issue-bvod.ts';
import type { SubscribeUseCase } from '../../application/use-cases/subscribe.ts';
import type { PublishContextEventUseCase } from '../../application/use-cases/publish-event.ts';
import type {
  AddRolePersonUseCase,
  ListRolePersonsUseCase,
} from '../../application/use-cases/manage-natural-persons.ts';
import type { ChainContextRepository } from '../../application/ports.ts';

export interface HealthProbe {
  check(): Promise<{ ok: boolean; detail?: string }>;
}

export interface MetricsRenderer {
  render(): string;
}

export interface RouterDeps {
  readonly createChainContext: CreateChainContextUseCase;
  readonly addParty: AddPartyUseCase;
  readonly removeParty: RemovePartyUseCase;
  readonly addDelegation: AddDelegationUseCase;
  readonly issueBvod: IssueBvodUseCase;
  readonly subscribe: SubscribeUseCase;
  readonly publishEvent: PublishContextEventUseCase;
  readonly addRolePerson: AddRolePersonUseCase;
  readonly listRolePersons: ListRolePersonsUseCase;
  readonly contexts: ChainContextRepository;
  readonly pseudonymSalt: string;
  readonly readinessProbes?: ReadonlyArray<HealthProbe>;
  readonly startupProbes?: ReadonlyArray<HealthProbe>;
  readonly metrics?: MetricsRenderer;
}

export function buildRouter(deps: RouterDeps): Router {
  const router = new Router();

  router.get('/health/live', async () => json(200, { status: 'ok' }));
  router.get('/health/ready', async () => {
    const r = await runProbes(deps.readinessProbes ?? []);
    return r.ok ? json(200, { status: 'ready', checks: r.checks }) : json(503, { status: 'not-ready', checks: r.checks });
  });
  router.get('/health/startup', async () => {
    const r = await runProbes(deps.startupProbes ?? []);
    return r.ok ? json(200, { status: 'started', checks: r.checks }) : json(503, { status: 'starting', checks: r.checks });
  });
  router.get('/metrics', async () => {
    if (!deps.metrics) return { status: 200, body: '# no metrics\n', headers: { 'content-type': 'text/plain' } };
    return { status: 200, headers: { 'content-type': 'text/plain; version=0.0.4' }, body: deps.metrics.render() };
  });

  router.post('/contexts', async (req) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'missing-body' });
    const assoc = parseAssociationId(String(body.association_id ?? ''));
    if (!assoc.ok) return json(400, { error: 'bad-association-id' });
    const orch = parseEuid(String(body.orchestrator ?? ''));
    if (!orch.ok) return json(400, { error: 'bad-orchestrator' });
    const kind = body.kind;
    if (kind !== 'order' && kind !== 'transport' && kind !== 'shipment' && kind !== 'custom')
      return json(400, { error: 'bad-kind' });
    const identifiers = Array.isArray(body.identifiers) ? body.identifiers : [];
    const valid_from = typeof body.valid_from === 'string' ? body.valid_from : new Date().toISOString();
    const valid_until = typeof body.valid_until === 'string' ? body.valid_until : null;
    const r = await deps.createChainContext.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind,
      identifiers: identifiers.map((i) => i as { scheme: string; value: string }),
      valid_from,
      valid_until,
    });
    if (!r.ok) return json(500, { error: r.error.type });
    return json(201, { chain_context_id: r.value.chainContextId });
  });

  router.get('/contexts/:id', async (req) => {
    const id = parseChainContextId(req.params.id!);
    if (!id.ok) return json(400, { error: 'bad-id' });
    const ctx = await deps.contexts.find(id.value);
    if (!ctx) return json(404, { error: 'not-found' });
    return json(200, ctx);
  });

  router.post('/contexts/:id/parties', async (req) => {
    const id = parseChainContextId(req.params.id!);
    if (!id.ok) return json(400, { error: 'bad-id' });
    const body = req.body as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'missing-body' });
    const actor = parseEuid(String(body.actor ?? ''));
    const member = parseEuid(String(body.member_euid ?? ''));
    if (!actor.ok || !member.ok) return json(400, { error: 'bad-euid' });
    const roles = Array.isArray(body.roles)
      ? (body.roles as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];
    const r = await deps.addParty.execute({
      chain_context_id: id.value,
      actor: actor.value,
      member_euid: member.value,
      roles,
      valid_from: typeof body.valid_from === 'string' ? body.valid_from : new Date().toISOString(),
      valid_until: typeof body.valid_until === 'string' ? body.valid_until : null,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(201, { status: 'added' });
  });

  router.delete('/contexts/:id/parties/:euid', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const euid = parseEuid(req.params.euid!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const actor = parseEuid(String(body.actor ?? ''));
    if (!id.ok || !euid.ok || !actor.ok) return json(400, { error: 'bad-input' });
    const r = await deps.removeParty.execute({
      chain_context_id: id.value,
      actor: actor.value,
      member_euid: euid.value,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(200, { status: 'removed' });
  });

  router.post('/contexts/:id/delegations', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const actor = parseEuid(String(body.actor ?? ''));
    const delegator = parseEuid(String(body.delegator ?? ''));
    const delegate = parseEuid(String(body.delegate ?? ''));
    if (!id.ok || !actor.ok || !delegator.ok || !delegate.ok)
      return json(400, { error: 'bad-input' });
    const scope = Array.isArray(body.action_scope)
      ? (body.action_scope as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const r = await deps.addDelegation.execute({
      chain_context_id: id.value,
      actor: actor.value,
      delegator: delegator.value,
      delegate: delegate.value,
      action_scope: scope,
      valid_until: typeof body.valid_until === 'string' ? body.valid_until : null,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(201, { status: 'delegated' });
  });

  router.post('/contexts/:id/bvod', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const subject = parseEuid(String(body.subject_euid ?? ''));
    const connector = parseConnectorId(String(body.subject_connector_id ?? ''));
    if (!id.ok || !subject.ok || !connector.ok) return json(400, { error: 'bad-input' });
    const audience = typeof body.audience === 'string' ? body.audience : connector.value;
    const r = await deps.issueBvod.execute({
      chain_context_id: id.value,
      subject_euid: subject.value,
      subject_connector_id: connector.value,
      audience,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(200, { bvod: r.value });
  });

  router.post('/contexts/:id/subscriptions', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const subscriber = parseEuid(String(body.subscriber_euid ?? ''));
    const connector = parseConnectorId(String(body.subscriber_connector_id ?? ''));
    if (!id.ok || !subscriber.ok || !connector.ok) return json(400, { error: 'bad-input' });
    const eventTypes = Array.isArray(body.event_types)
      ? (body.event_types as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    const callback = typeof body.callback_url === 'string' ? body.callback_url : '';
    const r = await deps.subscribe.execute({
      chain_context_id: id.value,
      subscriber_euid: subscriber.value,
      subscriber_connector_id: connector.value,
      event_types: eventTypes,
      callback_url: callback,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(201, { subscription_id: r.value.subscriptionId });
  });

  router.post('/contexts/:id/natural-persons', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const actor = parseEuid(String(body.actor ?? ''));
    const rawOrg =
      typeof body.organisation_euid === 'string' && body.organisation_euid
        ? body.organisation_euid
        : actor.ok
          ? actor.value
          : '';
    const organisation = parseEuid(rawOrg);
    const personRef = typeof body.person_ref === 'string' ? body.person_ref : null;
    const role = typeof body.role === 'string' ? body.role : null;
    if (!id.ok || !actor.ok || !organisation.ok || !personRef || !role) {
      return json(400, { error: 'bad-input' });
    }
    const r = await deps.addRolePerson.execute({
      chain_context_id: id.value,
      actor: actor.value,
      organisation_euid: organisation.value,
      personRef,
      role,
      salt: deps.pseudonymSalt,
      valid_from: typeof body.valid_from === 'string' ? body.valid_from : new Date().toISOString(),
      valid_until: typeof body.valid_until === 'string' ? body.valid_until : null,
    });
    if (!r.ok) return json(mapStatusNatural(r.error.type), { error: r.error.type });
    return json(201, { pseudonym: r.value.pseudonym });
  });

  router.get('/contexts/:id/natural-persons', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const actor = parseEuid(req.headers['x-bdi-actor-euid'] ?? '');
    if (!id.ok || !actor.ok) return json(400, { error: 'bad-input' });
    const r = await deps.listRolePersons.execute({
      chain_context_id: id.value,
      actor: actor.value,
    });
    if (!r.ok) return json(mapStatusNatural(r.error.type), { error: r.error.type });
    return json(200, { natural_persons: r.value });
  });

  router.post('/contexts/:id/events', async (req) => {
    const id = parseChainContextId(req.params.id!);
    const body = (req.body as Record<string, unknown> | null) ?? {};
    const publisher = parseEuid(String(body.publisher ?? ''));
    if (!id.ok || !publisher.ok) return json(400, { error: 'bad-input' });
    const type = typeof body.event_type === 'string' ? body.event_type : null;
    if (!type) return json(400, { error: 'missing-event-type' });
    const r = await deps.publishEvent.execute({
      chain_context_id: id.value,
      publisher: publisher.value,
      event_type: type,
      payload: body.payload,
    });
    if (!r.ok) return json(mapStatus(r.error.type), { error: r.error.type });
    return json(200, r.value);
  });

  return router;
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

function mapStatusNatural(type: string): number {
  switch (type) {
    case 'context-not-found':
      return 404;
    case 'not-a-party':
      return 403;
    case 'duplicate-pseudonym':
      return 409;
    default:
      return 400;
  }
}

function mapStatus(type: string): number {
  switch (type) {
    case 'context-not-found':
      return 404;
    case 'not-involved':
    case 'not-authorised':
      return 403;
    case 'party-already-present':
      return 409;
    case 'party-not-present':
    case 'delegator-not-present':
    case 'delegate-not-present':
    case 'empty-event-types':
    case 'bad-callback-url':
    case 'cannot-remove-orchestrator':
    case 'invalid-transition':
    case 'context-not-active':
      return 400;
    default:
      return 400;
  }
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
