// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { composeAsr, type AsrConfig } from './composition-root.ts';
import { toHttpRequest } from './interface/http/routes.ts';

export type ServerOptions = AsrConfig & { readonly port: number };

export interface AsrServer {
  readonly fetch: (req: Request) => Promise<Response>;
  readonly composition: Awaited<ReturnType<typeof composeAsr>>;
}

export async function createServer(options: ServerOptions): Promise<AsrServer> {
  const { port, ...asrConfig } = options;
  void port;
  const composition = await composeAsr(asrConfig);
  return {
    composition,
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === '/acme/ocsp' && (req.method === 'POST' || req.method === 'GET')) {
        let reqBody: Uint8Array;
        if (req.method === 'POST') {
          reqBody = new Uint8Array(await req.arrayBuffer());
        } else {
          const b64 = url.pathname.split('/').pop() ?? '';
          reqBody = Uint8Array.from(
            Buffer.from(decodeURIComponent(b64).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
          );
        }
        const out = await composition.acme.ocsp.respond(reqBody);
        if (!out) {
          return new Response('malformed-request', { status: 400 });
        }
        const respBuf = new ArrayBuffer(out.der.byteLength);
        new Uint8Array(respBuf).set(out.der);
        return new Response(respBuf, {
          status: 200,
          headers: { 'content-type': out.contentType },
        });
      }
      if (url.pathname === '/acme/directory' || url.pathname.startsWith('/acme/')) {
        return composition.acme.handler.handle(req);
      }
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
      } else if (req.body && ct.includes('application/x-www-form-urlencoded')) {
        const text = await req.text();
        const params = new URLSearchParams(text);
        const obj: Record<string, string> = {};
        params.forEach((v, k) => void (obj[k] = v));
        bodyJson = obj;
      }
      const httpReq = toHttpRequest(req, bodyJson);
      const resp = await composition.router.dispatch(httpReq);
      const headers = new Headers(resp.headers ?? {});
      let body: string | null = null;
      if (resp.body !== undefined && resp.body !== null) {
        if (typeof resp.body === 'string') {
          body = resp.body;
        } else {
          body = JSON.stringify(resp.body);
          if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        }
      }
      return new Response(body, { status: resp.status, headers });
    },
  };
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const port = Number(process.env.PORT ?? 8080);
  const issuer = process.env.ASR_ISSUER ?? `http://localhost:${port}`;
  const { fetch } = await createServer({ port, issuer });
  Bun.serve({ port, fetch });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'ASR listening', port, issuer }));
}
