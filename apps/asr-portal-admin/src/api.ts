// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Narrow ASR admin API client used by the portal. Keeps all HTTP details in
// one module so UI components stay declarative.

export interface MemberSummary {
  id: string;
  euid: string;
  legal_name: string;
  status: string;
  assurance_level: string | null;
}

export interface ConnectorSummary {
  connector_id: string;
  client_id?: string;
}

export class AsrClient {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async createMember(input: {
    euid: string;
    association_id: string;
    legal_name: string;
    signing_representative?: {
      subject_id: string;
      auth_source: 'eHerkenning' | 'eIDAS' | 'manual';
      assurance: 'substantial' | 'high';
      verified_at: string;
    };
  }): Promise<{ member_id: string }> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { member_id: string };
  }

  async runVerifications(memberId: string): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members/${memberId}/run-verifications`, {
      method: 'POST',
    });
    if (!res.ok) throw await toError(res);
  }

  async approve(memberId: string, approver: string): Promise<{ state: string }> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members/${memberId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approver }),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { state: string };
  }

  async suspend(memberId: string): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members/${memberId}/suspend`, {
      method: 'POST',
    });
    if (!res.ok) throw await toError(res);
  }

  async revoke(memberId: string): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members/${memberId}/revoke`, {
      method: 'POST',
    });
    if (!res.ok) throw await toError(res);
  }

  async trustlist(associationId: string): Promise<string> {
    const res = await this.fetcher(`${this.baseUrl}/.well-known/bdi/trustlist/${associationId}`);
    if (!res.ok) throw await toError(res);
    return res.text();
  }

  async jwks(): Promise<{ keys: unknown[] }> {
    const res = await this.fetcher(`${this.baseUrl}/.well-known/jwks.json`);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { keys: unknown[] };
  }
}

async function toError(res: Response): Promise<Error> {
  const text = await res.text();
  return new Error(`${res.status}: ${text}`);
}
