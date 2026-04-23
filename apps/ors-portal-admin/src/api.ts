// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

export interface ChainContextSummary {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly orchestrator_member_id: string;
  readonly parties: ReadonlyArray<{ member_euid: string; roles: ReadonlyArray<string> }>;
}

export class OrsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createContext(body: {
    association_id: string;
    orchestrator: string;
    kind: 'order' | 'transport' | 'shipment' | 'custom';
    identifiers?: Array<{ scheme: string; value: string }>;
    valid_from?: string;
    valid_until?: string | null;
  }): Promise<{ chain_context_id: string }> {
    const res = await this.fetcher(`${this.baseUrl}/contexts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as { chain_context_id: string };
  }

  async getContext(id: string): Promise<ChainContextSummary> {
    const res = await this.fetcher(`${this.baseUrl}/contexts/${id}`);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as ChainContextSummary;
  }

  async addParty(
    contextId: string,
    input: {
      actor: string;
      member_euid: string;
      roles: ReadonlyArray<string>;
      valid_from?: string;
      valid_until?: string | null;
    },
  ): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/contexts/${contextId}/parties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await toError(res);
  }

  async removeParty(contextId: string, actor: string, memberEuid: string): Promise<void> {
    const res = await this.fetcher(
      `${this.baseUrl}/contexts/${contextId}/parties/${memberEuid}`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor }),
      },
    );
    if (!res.ok) throw await toError(res);
  }

  async delegate(
    contextId: string,
    input: {
      actor: string;
      delegator: string;
      delegate: string;
      action_scope: ReadonlyArray<string>;
      valid_until?: string | null;
    },
  ): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/contexts/${contextId}/delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await toError(res);
  }

  async publishEvent(
    contextId: string,
    input: { publisher: string; event_type: string; payload: unknown },
  ): Promise<{ deliveries: ReadonlyArray<{ subscription_id: string; callback_url: string }> }> {
    const res = await this.fetcher(`${this.baseUrl}/contexts/${contextId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as {
      deliveries: ReadonlyArray<{ subscription_id: string; callback_url: string }>;
    };
  }
}

async function toError(res: Response): Promise<Error> {
  const text = await res.text();
  return new Error(`${res.status}: ${text}`);
}
