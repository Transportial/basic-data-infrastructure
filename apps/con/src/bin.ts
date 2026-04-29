#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { createServer } from './server.ts';

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

const bunRuntime = (globalThis as unknown as { Bun?: { serve: (opts: { port: number; fetch: (req: Request) => Promise<Response> }) => unknown } }).Bun;

if (bunRuntime) {
  bunRuntime.serve({ port, fetch });
} else {
  const { createServer: createNodeServer } = await import('node:http');
  const { Readable } = await import('node:stream');
  const server = createNodeServer(async (req, res) => {
    try {
      const host = req.headers.host ?? `localhost:${port}`;
      const url = `http://${host}${req.url ?? '/'}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
        else if (typeof v === 'string') headers.set(k, v);
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const init: RequestInit & { duplex?: 'half' } = { method: req.method ?? 'GET', headers };
      if (hasBody) {
        init.body = Readable.toWeb(req) as unknown as ReadableStream;
        init.duplex = 'half';
      }
      const fetchReq = new Request(url, init);
      const resp = await fetch(fetchReq);
      res.statusCode = resp.status;
      resp.headers.forEach((v, k) => res.setHeader(k, v));
      if (resp.body) {
        Readable.fromWeb(resp.body as never).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'internal-error', message: (err as Error).message }));
    }
  });
  server.listen(port);
}

console.log(JSON.stringify({ level: 'info', msg: 'CON listening', port }));
