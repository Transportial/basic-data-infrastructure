// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly params: Readonly<Record<string, string>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export type Handler = (req: HttpRequest) => Promise<HttpResponse>;

type RouteEntry = { readonly method: HttpMethod; readonly pattern: RegExp; readonly paramKeys: ReadonlyArray<string>; readonly handler: Handler };

// A minimal, dependency-free router. Mirrors Hono's ergonomics for our use cases
// without pulling in a heavy framework. Enough to mount all the required routes
// and, more importantly, simple enough to test exhaustively.
export class Router {
  private readonly routes: RouteEntry[] = [];

  add(method: HttpMethod, pathTemplate: string, handler: Handler): void {
    const paramKeys: string[] = [];
    const regex = pathTemplate
      .replace(/\/$/, '')
      .replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        paramKeys.push(key);
        return '/([^/]+)';
      });
    this.routes.push({
      method,
      pattern: new RegExp(`^${regex}$`),
      paramKeys,
      handler,
    });
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }
  post(path: string, handler: Handler): void {
    this.add('POST', path, handler);
  }
  put(path: string, handler: Handler): void {
    this.add('PUT', path, handler);
  }
  delete(path: string, handler: Handler): void {
    this.add('DELETE', path, handler);
  }

  match(method: HttpMethod, path: string): { handler: Handler; params: Record<string, string> } | null {
    const normalised = path.replace(/\/$/, '') || path;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(normalised);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramKeys.forEach((key, idx) => {
        params[key] = m[idx + 1]!;
      });
      return { handler: r.handler, params };
    }
    return null;
  }

  async dispatch(req: HttpRequest): Promise<HttpResponse> {
    const match = this.match(req.method, req.path);
    if (!match) return { status: 404, body: { error: 'not-found', path: req.path } };
    try {
      return await match.handler({ ...req, params: match.params });
    } catch (e) {
      return {
        status: 500,
        body: { error: 'internal', message: e instanceof Error ? e.message : 'unknown' },
      };
    }
  }
}
