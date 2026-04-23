// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { HeaderedHttpClient } from '../application/use-cases/proxy-forward.ts';
import type { ProxyResponse } from '../application/use-cases/proxy-forward.ts';

export class FetchHeaderedHttpClient implements HeaderedHttpClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number }> {
    const res = await this.fetcher(url, { method: 'POST', body, headers });
    return { status: res.status };
  }

  async request(
    method: string,
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProxyResponse> {
    const res = await this.fetcher(url, {
      method,
      ...(body.length > 0 && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
      headers,
    });
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => void (respHeaders[k] = v));
    const text = await res.text();
    return { status: res.status, headers: respHeaders, body: text };
  }
}

export class RecordingHeaderedHttpClient implements HeaderedHttpClient {
  readonly calls: Array<{
    method: string;
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }> = [];

  constructor(
    private readonly respond: (
      method: string,
      url: string,
      body: string,
      headers: Readonly<Record<string, string>>,
    ) => ProxyResponse | Promise<ProxyResponse> = () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    }),
  ) {}

  async post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number }> {
    const r = await this.request('POST', url, body, headers);
    return { status: r.status };
  }

  async request(
    method: string,
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProxyResponse> {
    this.calls.push({ method, url, body, headers });
    return this.respond(method, url, body, headers);
  }
}
