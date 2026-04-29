// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  parseAssociationId,
  parseEuid,
  validatePublicJwk,
  type Jwk,
} from '@transportial/kernel';
import { validateClientCredentialsRequest } from '@transportial/contracts';
import { Router, type HttpRequest, type HttpResponse } from './router.ts';
import type { StartOnboardingUseCase } from '../../application/use-cases/start-onboarding.ts';
import type { RunVerificationsUseCase } from '../../application/use-cases/run-verifications.ts';
import type { ActivateMemberUseCase } from '../../application/use-cases/activate-member.ts';
import type { ChangeMemberStatusUseCase } from '../../application/use-cases/change-member-status.ts';
import type { RegisterConnectorUseCase } from '../../application/use-cases/register-connector.ts';
import type { IssueBvadUseCase } from '../../application/use-cases/issue-bvad.ts';
import type { BuildTrustlistUseCase } from '../../application/use-cases/build-trustlist.ts';
import type { AuthenticateClientUseCase } from '../../application/use-cases/authenticate-client.ts';
import type { TokenExchangeUseCase } from '../../application/use-cases/token-exchange.ts';
import type { JwksService } from '../../application/use-cases/jwks.ts';
import type { BuildMemberDescriptorUseCase } from '../../application/use-cases/member-descriptor.ts';
import type { MemberRepository } from '../../application/ports.ts';

export interface HealthProbe {
  check(): Promise<{ ok: boolean; detail?: string }>;
}

export interface MetricsRenderer {
  render(): string;
}

export interface RouterDeps {
  readonly startOnboarding: StartOnboardingUseCase;
  readonly runVerifications: RunVerificationsUseCase;
  readonly activateMember: ActivateMemberUseCase;
  readonly changeStatus: ChangeMemberStatusUseCase;
  readonly registerConnector: RegisterConnectorUseCase;
  readonly issueBvad: IssueBvadUseCase;
  readonly buildTrustlist: BuildTrustlistUseCase;
  readonly authenticateClient: AuthenticateClientUseCase;
  readonly tokenExchange: TokenExchangeUseCase;
  readonly jwks: JwksService;
  readonly memberDescriptor: BuildMemberDescriptorUseCase;
  readonly members: MemberRepository;
  readonly tokenEndpointUrl: string;
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

  router.post('/admin/members', async (req) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'missing-body' });
    const euid = parseEuid(String(body.euid ?? ''));
    if (!euid.ok) return json(400, { error: 'bad-euid', detail: euid.error });
    const assoc = parseAssociationId(String(body.association_id ?? ''));
    if (!assoc.ok) return json(400, { error: 'bad-association-id' });
    const legalName = body.legal_name;
    if (typeof legalName !== 'string' || !legalName)
      return json(400, { error: 'missing-legal-name' });

    const result = await deps.startOnboarding.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: legalName,
      signing_representative:
        typeof body.signing_representative === 'object' && body.signing_representative !== null
          ? (body.signing_representative as {
              subject_id: string;
              auth_source: 'eHerkenning' | 'eIDAS' | 'manual';
              assurance: 'substantial' | 'high';
              verified_at: string;
            })
          : null,
      ...(typeof body.vat_number === 'string' ? { vat_number: body.vat_number } : {}),
      ...(typeof body.lei === 'string' ? { lei: body.lei } : {}),
    });
    if (!result.ok) {
      return json(409, { error: result.error.type });
    }
    return json(201, { member_id: result.value.memberId });
  });

  router.post('/admin/members/:id/run-verifications', async (req) => {
    const r = await deps.runVerifications.execute(req.params.id!);
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(202, { status: 'verifying' });
  });

  router.post('/admin/members/:id/approve', async (req) => {
    const body = req.body as Record<string, unknown>;
    const approver = typeof body?.approver === 'string' ? body.approver : null;
    if (!approver) return json(400, { error: 'missing-approver' });
    const r = await deps.activateMember.execute({ memberId: req.params.id!, approver });
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(200, r.value);
  });

  router.post('/admin/members/:id/suspend', async (req) => {
    const r = await deps.changeStatus.execute(req.params.id!, 'suspend');
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(200, { status: 'suspended' });
  });

  router.post('/admin/members/:id/reinstate', async (req) => {
    const r = await deps.changeStatus.execute(req.params.id!, 'reinstate');
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(200, { status: 'activated' });
  });

  router.post('/admin/members/:id/revoke', async (req) => {
    const r = await deps.changeStatus.execute(req.params.id!, 'revoke');
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(200, { status: 'revoked' });
  });

  router.post('/admin/connectors', async (req) => {
    const body = req.body as Record<string, unknown>;
    const memberId = typeof body?.member_id === 'string' ? body.member_id : null;
    const clientId = typeof body?.client_id === 'string' ? body.client_id : null;
    const jwk = validatePublicJwk(body?.jwk);
    const kid = typeof body?.kid === 'string' ? body.kid : null;
    const thumbprint = typeof body?.cert_thumbprint === 'string' ? body.cert_thumbprint : null;
    const notAfter = Number(body?.cert_not_after);
    const callbacks = Array.isArray(body?.callback_urls)
      ? (body.callback_urls as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];
    const authorisedBy = typeof body?.authorised_by === 'string' ? body.authorised_by : null;
    if (!memberId || !clientId || !jwk.ok || !kid || !thumbprint || !authorisedBy || !Number.isFinite(notAfter)) {
      return json(400, { error: 'bad-request' });
    }
    const r = await deps.registerConnector.execute({
      memberId,
      clientId,
      jwk: jwk.value as Jwk,
      kid,
      certThumbprint: thumbprint,
      certNotAfter: notAfter,
      callbackUrls: callbacks,
      authorisedBy,
    });
    if (!r.ok) return json(statusForError(r.error.type), { error: r.error.type });
    return json(201, { connector_id: r.value.connectorId });
  });

  router.post('/oauth2/token', async (req) => {
    const body = req.body as Record<string, unknown>;
    const grantType = typeof body?.grant_type === 'string' ? body.grant_type : '';
    if (grantType === 'urn:ietf:params:oauth:grant-type:token-exchange') {
      const r = await deps.tokenExchange.execute({
        subjectToken: typeof body?.subject_token === 'string' ? body.subject_token : '',
        audience: typeof body?.audience === 'string' ? body.audience : '',
        ...(typeof body?.scope === 'string' ? { scope: body.scope } : {}),
      });
      if (!r.ok) return json(400, { error: 'invalid_request', error_description: r.error.type });
      return json(200, {
        access_token: r.value,
        issued_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        token_type: 'Bearer',
        expires_in: 600,
      });
    }

    const validated = validateClientCredentialsRequest(body);
    if (!validated.ok) {
      return json(400, { error: 'invalid_request' });
    }
    const audience = typeof body?.audience === 'string' ? body.audience : validated.value.client_id;
    const auth = await deps.authenticateClient.execute({
      clientId: validated.value.client_id,
      clientAssertion: validated.value.client_assertion,
      expectedAudience: deps.tokenEndpointUrl,
    });
    if (!auth.ok) {
      return json(401, {
        error: 'invalid_client',
        error_description: auth.error.type,
      });
    }
    const r = await deps.issueBvad.execute({
      clientId: validated.value.client_id,
      audience,
    });
    if (!r.ok) return json(401, { error: 'invalid_client', error_description: r.error.type });
    return json(200, { access_token: r.value, token_type: 'Bearer', expires_in: 600 });
  });

  router.get('/.well-known/jwks.json', async () => {
    const keys = await deps.jwks.current();
    return json(200, { keys });
  });

  router.get('/.well-known/oauth-authorization-server', async () => {
    return json(200, {
      issuer: deps.tokenEndpointUrl.replace(/\/oauth2\/token$/, ''),
      token_endpoint: deps.tokenEndpointUrl,
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['ES256', 'ES384', 'EdDSA', 'PS256'],
      grant_types_supported: ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      jwks_uri: deps.tokenEndpointUrl.replace(/\/oauth2\/token$/, '/.well-known/jwks.json'),
    });
  });

  router.get('/.well-known/bdi/trustlist/:association', async (req) => {
    const assoc = parseAssociationId(req.params.association!);
    if (!assoc.ok) return json(400, { error: 'bad-association-id' });
    const r = await deps.buildTrustlist.execute(assoc.value);
    if (!r.ok) return json(500, { error: 'internal' });
    return { status: 200, headers: { 'content-type': 'application/jose' }, body: r.value.jws };
  });

  router.get('/.well-known/bdi/members/:euid', async (req) => {
    const euid = parseEuid(req.params.euid!);
    if (!euid.ok) return json(400, { error: 'bad-euid' });
    const r = await deps.memberDescriptor.execute(euid.value);
    if (!r.ok) return json(404, { error: r.error.type });
    return { status: 200, headers: { 'content-type': 'application/jose' }, body: r.value };
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

function statusForError(type: string): number {
  switch (type) {
    case 'member-not-found':
      return 404;
    case 'client-id-taken':
    case 'already-active':
      return 409;
    case 'bad-state':
    case 'not-verified':
    case 'bad-jwk':
    case 'bad-callback-url':
    case 'invalid-transition':
    case 'bad-connector-id':
      return 400;
    case 'self-approval-forbidden':
      return 403;
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
