// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import {
  base64UrlDecode,
  base64UrlEncode,
  jwkThumbprint,
  validatePublicJwk,
  type Jwk,
} from '@bdi/kernel';
import { InMemoryTrustlist, JwkSigner } from '@bdi/crypto';
import type {
  AcmeServices,
} from './server.ts';
import {
  FinalizeOrderUseCase,
  NewAccountUseCase,
  NewOrderUseCase,
  RespondToChallengeUseCase,
  RevokeCertificateUseCase,
} from './server.ts';
import type { AcmeOrder, Authorization, ChallengeType, Identifier } from './types.ts';

// Routes implementing the RFC 8555 directory, nonce, account, order,
// authorization, challenge, finalize, certificate, and revoke-cert
// endpoints. Each route returns a Response; a thin `handle(request)` at the
// bottom dispatches on method+path.

export interface AcmeHttp {
  handle(req: Request): Promise<Response>;
}

export function buildAcmeHttp(services: AcmeServices): AcmeHttp {
  const newAccount = new NewAccountUseCase(services);
  const newOrder = new NewOrderUseCase(services);
  const respondChallenge = new RespondToChallengeUseCase(services);
  const finalizeOrder = new FinalizeOrderUseCase(services);
  const revoke = new RevokeCertificateUseCase(services);
  const base = services.config.directoryBaseUrl;

  async function directory(): Promise<Response> {
    return jsonResponse(200, {
      newNonce: `${base}/acme/new-nonce`,
      newAccount: `${base}/acme/new-account`,
      newOrder: `${base}/acme/new-order`,
      revokeCert: `${base}/acme/revoke-cert`,
      keyChange: `${base}/acme/key-change`,
      meta: {
        termsOfService: services.config.termsOfService,
        website: services.config.website,
        externalAccountRequired: true,
      },
    });
  }

  async function newNonce(): Promise<Response> {
    const nonce = await services.nonces.issue();
    return new Response(null, {
      status: 204,
      headers: {
        'replay-nonce': nonce,
        'cache-control': 'no-store',
        link: `<${base}/acme/directory>;rel="index"`,
      },
    });
  }

  async function unwrapJws(req: Request): Promise<
    | { ok: true; header: AcmeJwsHeader; payload: unknown; payloadB64: string; rawCompact: string; nonce: string }
    | { ok: false; response: Response }
  > {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { ok: false, response: acmeError('malformed', 'body not JSON', 400) };
    }
    const flattened = body as {
      protected?: string;
      payload?: string;
      signature?: string;
    };
    if (
      typeof flattened.protected !== 'string' ||
      typeof flattened.payload !== 'string' ||
      typeof flattened.signature !== 'string'
    ) {
      return { ok: false, response: acmeError('malformed', 'not a flattened JWS', 400) };
    }
    let header: AcmeJwsHeader;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(flattened.protected))) as AcmeJwsHeader;
    } catch {
      return { ok: false, response: acmeError('malformed', 'bad protected header', 400) };
    }
    const nonceOk = await services.nonces.consume(header.nonce ?? '');
    if (!nonceOk) {
      const fresh = await services.nonces.issue();
      return { ok: false, response: acmeError('badNonce', 'nonce unknown or used', 400, { 'replay-nonce': fresh }) };
    }
    const compact = `${flattened.protected}.${flattened.payload}.${flattened.signature}`;
    const payloadRaw = flattened.payload === '' ? {} : JSON.parse(new TextDecoder().decode(base64UrlDecode(flattened.payload)));
    return {
      ok: true,
      header,
      payload: payloadRaw,
      payloadB64: flattened.payload,
      rawCompact: compact,
      nonce: header.nonce ?? '',
    };
  }

  async function verifyAccountJws(
    compact: string,
    header: AcmeJwsHeader,
  ): Promise<{ accountId: string; publicJwk: Jwk } | null> {
    if (!header.kid) return null;
    const accountId = header.kid.split('/').pop() ?? '';
    const account = await services.accounts.find(accountId);
    if (!account || account.status !== 'valid') return null;
    if (!(await verifyJwsSignature(compact, account.publicJwk, header.alg))) return null;
    return { accountId, publicJwk: account.publicJwk };
  }

  async function newAccountRoute(req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const { header, payload, rawCompact } = unwrapped;
    if (!header.jwk) return acmeError('malformed', 'new-account must use jwk', 400);
    if (!(await verifyJwsSignature(rawCompact, header.jwk, header.alg))) {
      return acmeError('unauthorized', 'jws signature invalid', 401);
    }
    const body = payload as {
      contact?: string[];
      termsOfServiceAgreed?: boolean;
      externalAccountBinding?: { protected: string; payload: string; signature: string };
    };
    if (!body.externalAccountBinding) return acmeError('externalAccountRequired', 'EAB missing', 400);

    let eabProtected: { kid: string; alg: 'HS256' };
    try {
      eabProtected = JSON.parse(
        new TextDecoder().decode(base64UrlDecode(body.externalAccountBinding.protected)),
      ) as { kid: string; alg: 'HS256' };
    } catch {
      return acmeError('malformed', 'bad EAB protected', 400);
    }

    const thumbprint = await jwkThumbprint(header.jwk);
    const existing = await services.accounts.findByJwkThumbprint(thumbprint);
    if (existing) {
      return jsonResponse(200, toAccountResponse(existing), {
        location: `${base}/acme/accounts/${existing.id}`,
        'replay-nonce': await services.nonces.issue(),
      });
    }

    const input = {
      jwk: header.jwk,
      termsOfServiceAgreed: !!body.termsOfServiceAgreed,
      externalAccountBinding: {
        protected: eabProtected,
        payload: body.externalAccountBinding.payload,
        signature: body.externalAccountBinding.signature,
      },
      ...(body.contact !== undefined ? { contact: body.contact } : {}),
    };
    const r = await newAccount.execute(input);
    if (!r.ok) {
      return acmeError(r.error.type, r.error.type, r.error.type === 'invalid-jwk' ? 400 : 403);
    }
    return jsonResponse(201, toAccountResponse(r.value), {
      location: `${base}/acme/accounts/${r.value.id}`,
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function newOrderRoute(req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid or signature', 401);
    const body = unwrapped.payload as {
      identifiers?: Array<{ type: string; value: string }>;
      notBefore?: string;
      notAfter?: string;
    };
    const identifiers: Identifier[] =
      body.identifiers?.filter(
        (i): i is Identifier => i.type === 'dns' || i.type === 'ip',
      ) ?? [];
    const r = await newOrder.execute({
      accountId: auth.accountId,
      identifiers,
      ...(body.notBefore !== undefined ? { notBefore: body.notBefore } : {}),
      ...(body.notAfter !== undefined ? { notAfter: body.notAfter } : {}),
    });
    if (!r.ok) return acmeError(r.error.type, r.error.type, 400);
    return jsonResponse(201, toOrderResponse(r.value, base), {
      location: `${base}/acme/orders/${r.value.id}`,
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function getOrderRoute(id: string, req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const order = await services.orders.find(id);
    if (!order || order.accountId !== auth.accountId) return acmeError('not-found', 'no such order', 404);
    return jsonResponse(200, toOrderResponse(order, base), {
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function getAuthzRoute(id: string, req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const authz = await services.authorizations.find(id);
    if (!authz || authz.accountId !== auth.accountId) return acmeError('not-found', 'no such authz', 404);
    return jsonResponse(200, toAuthorizationResponse(authz), {
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function respondChallengeRoute(authzId: string, challengeId: string, req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const r = await respondChallenge.execute({
      accountId: auth.accountId,
      authorizationId: authzId,
      challengeId,
    });
    if (!r.ok) {
      return acmeError(r.error.type, r.error.type, r.error.type === 'unknown-challenge' ? 404 : 400);
    }
    return jsonResponse(200, r.value, {
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function finalizeOrderRoute(orderId: string, req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const body = unwrapped.payload as { csr?: string };
    if (!body.csr) return acmeError('malformed', 'missing csr', 400);
    const csrDer = base64UrlDecode(body.csr);
    const r = await finalizeOrder.execute({
      accountId: auth.accountId,
      orderId,
      csrDer,
    });
    if (!r.ok) return acmeError(r.error.type, r.error.type, 400);
    return jsonResponse(200, toOrderResponse(r.value, base), {
      'replay-nonce': await services.nonces.issue(),
    });
  }

  async function certificateRoute(serial: string, req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const cert = await services.certificates.find(serial);
    if (!cert || cert.accountId !== auth.accountId) return acmeError('not-found', 'no such cert', 404);
    return new Response(cert.pem, {
      status: 200,
      headers: {
        'content-type': 'application/pem-certificate-chain',
        'replay-nonce': await services.nonces.issue(),
      },
    });
  }

  async function revokeRoute(req: Request): Promise<Response> {
    const unwrapped = await unwrapJws(req);
    if (!unwrapped.ok) return unwrapped.response;
    const auth = await verifyAccountJws(unwrapped.rawCompact, unwrapped.header);
    if (!auth) return acmeError('unauthorized', 'bad kid', 401);
    const body = unwrapped.payload as { certificate?: string; reason?: number; serial?: string };
    if (!body.serial) return acmeError('malformed', 'serial required', 400);
    const r = await revoke.execute({
      accountId: auth.accountId,
      serial: body.serial,
      ...(body.reason !== undefined ? { reason: String(body.reason) } : {}),
    });
    if (!r.ok) return acmeError(r.error.type, r.error.type, 400);
    return new Response(null, {
      status: 200,
      headers: { 'replay-nonce': await services.nonces.issue() },
    });
  }

  return {
    async handle(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      if (req.method === 'GET' && path === '/acme/directory') return directory();
      if (req.method === 'HEAD' && path === '/acme/new-nonce') return newNonce();
      if (req.method === 'GET' && path === '/acme/new-nonce') return newNonce();
      if (req.method !== 'POST') {
        return acmeError('malformed', 'method not allowed', 405);
      }
      if (path === '/acme/new-account') return newAccountRoute(req);
      if (path === '/acme/new-order') return newOrderRoute(req);
      if (path === '/acme/revoke-cert') return revokeRoute(req);
      let m = /^\/acme\/orders\/([^/]+)$/.exec(path);
      if (m) return getOrderRoute(m[1]!, req);
      m = /^\/acme\/finalize\/([^/]+)$/.exec(path);
      if (m) return finalizeOrderRoute(m[1]!, req);
      m = /^\/acme\/authz\/([^/]+)$/.exec(path);
      if (m) return getAuthzRoute(m[1]!, req);
      m = /^\/acme\/challenge\/([^/]+)\/([^/]+)$/.exec(path);
      if (m) return respondChallengeRoute(m[1]!, m[2]!, req);
      m = /^\/acme\/cert\/([^/]+)$/.exec(path);
      if (m) return certificateRoute(m[1]!, req);
      return acmeError('not-found', path, 404);
    },
  };
}

interface AcmeJwsHeader {
  alg: string;
  nonce?: string;
  url?: string;
  kid?: string;
  jwk?: Jwk;
}

async function verifyJwsSignature(compact: string, jwk: Jwk, alg: string): Promise<boolean> {
  const thumbprintKid = await jwkThumbprint(jwk);
  const trustlist = new InMemoryTrustlist();
  const signer = await jwkToRawSigner(jwk, alg);
  if (!signer) return false;
  trustlist.add({ kid: thumbprintKid, signer });

  const parts = compact.split('.');
  if (parts.length !== 3) return false;
  try {
    const bodyPair = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = base64UrlDecode(parts[2]!);
    return signer.verify(bodyPair, sig);
  } catch {
    return false;
  }
}

async function jwkToRawSigner(jwk: Jwk, alg: string): Promise<JwkSigner | null> {
  const validated = validatePublicJwk(jwk);
  if (!validated.ok) return null;
  const keyAlg = mapAlg(alg);
  if (!keyAlg) return null;
  return new JwkSigner(validated.value, keyAlg);
}

function mapAlg(alg: string): 'ES256' | 'ES384' | 'EdDSA' | 'PS256' | null {
  switch (alg) {
    case 'ES256':
      return 'ES256';
    case 'ES384':
      return 'ES384';
    case 'EdDSA':
      return 'EdDSA';
    case 'PS256':
      return 'PS256';
    default:
      return null;
  }
}

function acmeError(
  type: string,
  detail: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ type: `urn:ietf:params:acme:error:${type}`, detail, status }),
    {
      status,
      headers: {
        'content-type': 'application/problem+json',
        ...extraHeaders,
      },
    },
  );
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });
}

function toAccountResponse(a: {
  id: string;
  status: string;
  contact: ReadonlyArray<string>;
  termsOfServiceAgreed: boolean;
  orders: string;
}): unknown {
  return {
    status: a.status,
    contact: a.contact,
    termsOfServiceAgreed: a.termsOfServiceAgreed,
    orders: a.orders,
  };
}

function toOrderResponse(o: AcmeOrder, base: string): unknown {
  return {
    status: o.status,
    expires: o.expires,
    identifiers: o.identifiers,
    notBefore: o.notBefore,
    notAfter: o.notAfter,
    authorizations: o.authorizationIds.map((id) => `${base}/acme/authz/${id}`),
    finalize: o.finalizeUrl,
    certificate: o.certificateSerial ? `${base}/acme/cert/${o.certificateSerial}` : undefined,
  };
}

function toAuthorizationResponse(a: Authorization): unknown {
  return {
    status: a.status,
    identifier: a.identifier,
    expires: a.expires,
    challenges: a.challenges.map((c) => ({
      type: c.type as ChallengeType,
      status: c.status,
      url: c.url,
      token: c.token,
      validated: c.validated,
    })),
    wildcard: a.wildcard,
  };
}

export { base64UrlEncode };
