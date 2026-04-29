// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { HttpClientPort } from '../application/ports.ts';

export class FetchHttpClient implements HttpClientPort {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number }> {
    const res = await this.fetcher(url, { method: 'POST', body, headers });
    return { status: res.status };
  }
}

export class RecordingHttpClient implements HttpClientPort {
  readonly calls: Array<{
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }> = [];
  constructor(private readonly statusFn: (n: number) => number = () => 200) {}
  async post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number }> {
    this.calls.push({ url, body, headers });
    return { status: this.statusFn(this.calls.length) };
  }
}
