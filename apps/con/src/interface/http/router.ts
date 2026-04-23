// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

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

type RouteEntry = {
  readonly method: HttpMethod;
  readonly pattern: RegExp;
  readonly paramKeys: ReadonlyArray<string>;
  readonly handler: Handler;
};

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
    this.routes.push({ method, pattern: new RegExp(`^${regex}$`), paramKeys, handler });
  }

  get(p: string, h: Handler): void { this.add('GET', p, h); }
  post(p: string, h: Handler): void { this.add('POST', p, h); }
  put(p: string, h: Handler): void { this.add('PUT', p, h); }
  delete(p: string, h: Handler): void { this.add('DELETE', p, h); }

  match(method: HttpMethod, path: string): { handler: Handler; params: Record<string, string> } | null {
    const normalised = path.replace(/\/$/, '') || path;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(normalised);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramKeys.forEach((key, idx) => void (params[key] = m[idx + 1]!));
      return { handler: r.handler, params };
    }
    return null;
  }

  async dispatch(req: HttpRequest): Promise<HttpResponse> {
    const m = this.match(req.method, req.path);
    if (!m) return { status: 404, body: { error: 'not-found', path: req.path } };
    try {
      return await m.handler({ ...req, params: m.params });
    } catch (e) {
      return {
        status: 500,
        body: { error: 'internal', message: e instanceof Error ? e.message : 'unknown' },
      };
    }
  }
}
