// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { ServiceFetch } from './network.ts';

export interface JsonResponse<T = unknown> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
  readonly raw: string;
}

// A small client wrapper bound to one service's base URL. Test code calls
// `client.post('/admin/members', body)` instead of constructing Requests by hand.
export class ServiceClient {
  constructor(
    public readonly name: string,
    public readonly baseUrl: string,
    private readonly serviceFetch: ServiceFetch,
  ) {}

  async fetch(req: Request): Promise<Response> {
    return this.serviceFetch(req);
  }

  async get<T = unknown>(
    path: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<JsonResponse<T>> {
    return this.send<T>('GET', path, undefined, headers);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<JsonResponse<T>> {
    return this.send<T>('POST', path, body, headers);
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<JsonResponse<T>> {
    return this.send<T>('PUT', path, body, headers);
  }

  async delete<T = unknown>(
    path: string,
    body?: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<JsonResponse<T>> {
    return this.send<T>('DELETE', path, body, headers);
  }

  async form<T = unknown>(
    path: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<JsonResponse<T>> {
    const req = new Request(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const res = await this.serviceFetch(req);
    return readJson<T>(res);
  }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<JsonResponse<T>> {
    const merged: Record<string, string> = { ...headers };
    const init: RequestInit = { method, headers: merged };
    if (body !== undefined) {
      if (!('content-type' in merged)) merged['content-type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await this.serviceFetch(new Request(this.url(path), init));
    return readJson<T>(res);
  }
}

async function readJson<T>(res: Response): Promise<JsonResponse<T>> {
  const raw = await res.text();
  let body: unknown = null;
  if (raw.length > 0) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else {
      body = raw;
    }
  }
  return { status: res.status, headers: res.headers, body: body as T, raw };
}
