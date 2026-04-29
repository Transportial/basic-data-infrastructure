// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export type ServiceFetch = (req: Request) => Promise<Response>;

interface Registration {
  readonly baseUrl: string;
  readonly fetch: ServiceFetch;
}

// In-process multi-host network. Each service is registered with the base URL
// it would have in a real deployment (e.g. `https://asr.ctn.test`). Any request
// whose URL starts with that base is delegated to that service's `fetch`.
//
// The network exposes a `fetch` function with the same shape as global `fetch`,
// so it can be passed straight into anything that takes a `typeof fetch`
// (e.g. CON's FetchHttpClient).
export class Network {
  private readonly registrations: Registration[] = [];

  register(baseUrl: string, fetch: ServiceFetch): void {
    const normalised = stripTrailingSlash(baseUrl);
    if (this.registrations.some((r) => r.baseUrl === normalised)) {
      throw new Error(`network: ${normalised} is already registered`);
    }
    this.registrations.push({ baseUrl: normalised, fetch });
  }

  // Fetch with the same shape as global `fetch` so it can be used as a
  // drop-in dependency for HttpClient-style ports.
  readonly fetch: typeof fetch = (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const target = this.match(req.url);
    if (!target) {
      return new Response(JSON.stringify({ error: 'no-route', url: req.url }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    return target.fetch(req);
  }) as typeof fetch;

  private match(url: string): Registration | null {
    for (const r of this.registrations) {
      if (url === r.baseUrl || url.startsWith(`${r.baseUrl}/`)) return r;
    }
    return null;
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
