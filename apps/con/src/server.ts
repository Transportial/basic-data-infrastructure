// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { composeCon, type ConConfig } from './composition-root.ts';
import { toHttpRequest } from './interface/http/routes.ts';

export type ServerOptions = ConConfig & { readonly port: number };

export function createServer(options: ServerOptions): {
  fetch: (req: Request) => Promise<Response>;
  composition: ReturnType<typeof composeCon>;
} {
  const { port, ...conConfig } = options;
  void port;
  const composition = composeCon(conConfig);
  return {
    composition,
    fetch: async (req: Request) => {
      let bodyJson: unknown = null;
      const ct = req.headers.get('content-type') ?? '';
      if (req.body && ct.includes('application/json')) {
        try {
          bodyJson = await req.json();
        } catch {
          return new Response(JSON.stringify({ error: 'invalid-json' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      const httpReq = toHttpRequest(req, bodyJson);
      const resp = await composition.router.dispatch(httpReq);
      const headers = new Headers(resp.headers ?? {});
      let body: string | null = null;
      if (resp.body !== undefined && resp.body !== null) {
        body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      return new Response(body, { status: resp.status, headers });
    },
  };
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const port = Number(process.env.PORT ?? 8443);
  const asrIssuer = process.env.ASR_ISSUER ?? 'http://localhost:8080';
  const orsIssuer = process.env.ORS_ISSUER ?? 'http://localhost:8081';
  const associationId = process.env.ASSOCIATION_ID ?? 'ctn';
  const ownConnectorId =
    process.env.CONNECTOR_ID ?? 'urn:bdi:connector:00000000-0000-4000-8000-000000000001';
  const audience = process.env.CON_AUDIENCE ?? ownConnectorId;
  const { fetch } = createServer({
    port,
    asrIssuer,
    orsIssuer,
    associationId,
    ownConnectorId,
    audience,
  });
  Bun.serve({ port, fetch });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'CON listening', port }));
}
