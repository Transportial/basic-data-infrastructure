// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { composeOrs, type OrsConfig } from './composition-root.ts';
import { toHttpRequest } from './interface/http/routes.ts';

export type ServerOptions = OrsConfig & { readonly port: number };

export function createServer(options: ServerOptions): {
  fetch: (req: Request) => Promise<Response>;
  composition: ReturnType<typeof composeOrs>;
} {
  const { port, ...orsConfig } = options;
  void port;
  const composition = composeOrs(orsConfig);
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

