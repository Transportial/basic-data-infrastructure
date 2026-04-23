// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { composeAsr, type AsrConfig } from './composition-root.ts';
import { toHttpRequest } from './interface/http/routes.ts';

export type ServerOptions = AsrConfig & { readonly port: number };

export function createServer(options: ServerOptions): {
  fetch: (req: Request) => Promise<Response>;
  composition: ReturnType<typeof composeAsr>;
} {
  const { port, ...asrConfig } = options;
  void port;
  const composition = composeAsr(asrConfig);
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

// Bun.serve entry point — guarded so the module is importable without listening.
if (
  typeof Bun !== 'undefined' &&
  typeof (globalThis as { BDI_NO_LISTEN?: boolean }).BDI_NO_LISTEN === 'undefined' &&
  import.meta.main
) {
  const port = Number(process.env.PORT ?? 8080);
  const issuer = process.env.ASR_ISSUER ?? `http://localhost:${port}`;
  const { fetch } = createServer({ port, issuer });
  Bun.serve({ port, fetch });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'ASR listening', port, issuer }));
}
