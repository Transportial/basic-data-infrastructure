// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { AuthnPort, Principal } from '@bdi/identity';
import type { HttpRequest, HttpResponse, Router } from './router.ts';

// requireAuth wraps admin routes so that every request must carry a bearer
// token that the injected AuthnPort (OIDC, SAML, or static) accepts. The
// principal is attached to the request body as `__principal` for downstream
// handlers that need to check roles; the auth check itself only verifies
// identity (authorization is handled by per-route role checks or a PDP).

export interface AdminAuthOptions {
  readonly authn: AuthnPort;
  readonly requiredRoles?: ReadonlyArray<string>;
  readonly pathPrefix?: string;
}

export function wrapAdminAuth(router: Router, options: AdminAuthOptions): Router {
  const prefix = options.pathPrefix ?? '/admin/';
  const originalDispatch = router.dispatch.bind(router);
  router.dispatch = async (req: HttpRequest): Promise<HttpResponse> => {
    if (!req.path.startsWith(prefix)) {
      return originalDispatch(req);
    }
    const bearer = extractBearer(req);
    if (!bearer) {
      return {
        status: 401,
        headers: { 'www-authenticate': 'Bearer realm="asr-admin"' },
        body: { error: 'missing-token' },
      };
    }
    const result = await options.authn.authenticate(bearer);
    if (!result.ok) {
      return {
        status: 401,
        headers: { 'www-authenticate': 'Bearer realm="asr-admin"' },
        body: { error: result.error.type },
      };
    }
    if (options.requiredRoles && options.requiredRoles.length > 0) {
      if (!hasAnyRole(result.value, options.requiredRoles)) {
        return { status: 403, body: { error: 'forbidden', required: options.requiredRoles } };
      }
    }
    const principal = result.value;
    const enriched: HttpRequest = {
      ...req,
      headers: { ...req.headers, 'x-principal-subject': principal.subject },
    };
    return originalDispatch(enriched);
  };
  return router;
}

function extractBearer(req: HttpRequest): string {
  const auth = req.headers['authorization'] ?? req.headers['Authorization'] ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function hasAnyRole(p: Principal, required: ReadonlyArray<string>): boolean {
  return required.some((r) => p.roles.includes(r));
}
