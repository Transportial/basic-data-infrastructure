// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { euidLocalId, type Euid } from '@transportial/kernel';
import type { VerificationSource } from '../application/ports.ts';

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class SystemFetcher implements Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// KvK "Basisprofiel v2" adapter. The integrator provides the API key and base
// URL; we keep only an evidence hash, not the PII-bearing raw response.
export class KvkVerificationSource implements VerificationSource {
  readonly name = 'KvK' as const;
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      fetcher?: Fetcher;
    },
  ) {}

  async verify(input: { euid: Euid; legal_name: string }): Promise<{
    outcome: 'success' | 'failure' | 'partial';
    evidence_hash: string;
  }> {
    const fetcher = this.options.fetcher ?? new SystemFetcher();
    const kvk = euidLocalId(input.euid);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/v2/basisprofielen/${encodeURIComponent(kvk)}`;
    const res = await fetcher.fetch(url, {
      method: 'GET',
      headers: { apikey: this.options.apiKey, accept: 'application/json' },
    });
    const body = await res.text();
    const hash = await sha256Hex(`${res.status}:${body}`);
    if (res.status === 200) {
      try {
        const parsed = JSON.parse(body) as { handelsnaam?: string; naam?: string };
        const name = (parsed.naam ?? parsed.handelsnaam ?? '').toLowerCase();
        if (name && name === input.legal_name.toLowerCase()) return { outcome: 'success', evidence_hash: hash };
        return { outcome: 'partial', evidence_hash: hash };
      } catch {
        return { outcome: 'partial', evidence_hash: hash };
      }
    }
    return { outcome: 'failure', evidence_hash: hash };
  }
}

// VIES - European VAT validation. Uses the REST endpoint (MS-REST) rather than
// SOAP so we stay dependency-free.
export class ViesVerificationSource implements VerificationSource {
  readonly name = 'VIES' as const;
  constructor(private readonly options: { baseUrl: string; fetcher?: Fetcher }) {}

  async verify(input: { euid: Euid; legal_name: string }): Promise<{
    outcome: 'success' | 'failure' | 'partial';
    evidence_hash: string;
  }> {
    const fetcher = this.options.fetcher ?? new SystemFetcher();
    const country = input.euid.split('.', 1)[0]!;
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/check-vat-number`;
    const res = await fetcher.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ countryCode: country, vatNumber: euidLocalId(input.euid) }),
    });
    const body = await res.text();
    const hash = await sha256Hex(`${res.status}:${body}`);
    if (res.status === 200) {
      try {
        const parsed = JSON.parse(body) as { valid?: boolean; name?: string };
        if (parsed.valid) {
          if (parsed.name && parsed.name.toLowerCase().includes(input.legal_name.toLowerCase())) {
            return { outcome: 'success', evidence_hash: hash };
          }
          return { outcome: 'partial', evidence_hash: hash };
        }
        return { outcome: 'failure', evidence_hash: hash };
      } catch {
        return { outcome: 'failure', evidence_hash: hash };
      }
    }
    return { outcome: 'failure', evidence_hash: hash };
  }
}

// GLEIF - Global LEI Foundation lookup.
export class GleifVerificationSource implements VerificationSource {
  readonly name = 'GLEIF' as const;
  constructor(
    private readonly options: { baseUrl: string; lei: string; fetcher?: Fetcher },
  ) {}

  async verify(input: { euid: Euid; legal_name: string }): Promise<{
    outcome: 'success' | 'failure' | 'partial';
    evidence_hash: string;
  }> {
    const fetcher = this.options.fetcher ?? new SystemFetcher();
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/lei-records/${encodeURIComponent(this.options.lei)}`;
    const res = await fetcher.fetch(url, {
      method: 'GET',
      headers: { accept: 'application/vnd.api+json' },
    });
    const body = await res.text();
    const hash = await sha256Hex(`${res.status}:${body}`);
    if (res.status === 200) {
      try {
        const parsed = JSON.parse(body) as {
          data?: { attributes?: { entity?: { legalName?: { name?: string } } } };
        };
        const name = parsed.data?.attributes?.entity?.legalName?.name?.toLowerCase();
        if (name && name.includes(input.legal_name.toLowerCase())) {
          return { outcome: 'success', evidence_hash: hash };
        }
        return { outcome: 'partial', evidence_hash: hash };
      } catch {
        return { outcome: 'partial', evidence_hash: hash };
      }
    }
    // Non-200 from GLEIF is treated as partial rather than definitive failure:
    // LEI data source may be rate-limited or temporarily down and other
    // registries (KvK/KBO/VIES) compensate.
    return { outcome: 'partial', evidence_hash: hash };
  }
}

// Belgian KBO lookup. Some member states require a commercial contract — in
// those cases the integrator passes a fetcher with the right auth.
export class KboVerificationSource implements VerificationSource {
  readonly name = 'KBO' as const;
  constructor(
    private readonly options: { baseUrl: string; apiKey?: string; fetcher?: Fetcher },
  ) {}

  async verify(input: { euid: Euid; legal_name: string }): Promise<{
    outcome: 'success' | 'failure' | 'partial';
    evidence_hash: string;
  }> {
    const fetcher = this.options.fetcher ?? new SystemFetcher();
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/enterprise/${encodeURIComponent(
      euidLocalId(input.euid),
    )}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const res = await fetcher.fetch(url, { method: 'GET', headers });
    const body = await res.text();
    const hash = await sha256Hex(`${res.status}:${body}`);
    if (res.status !== 200) return { outcome: 'failure', evidence_hash: hash };
    try {
      const parsed = JSON.parse(body) as { name?: string };
      if (parsed.name?.toLowerCase() === input.legal_name.toLowerCase()) {
        return { outcome: 'success', evidence_hash: hash };
      }
      return { outcome: 'partial', evidence_hash: hash };
    } catch {
      return { outcome: 'partial', evidence_hash: hash };
    }
  }
}
