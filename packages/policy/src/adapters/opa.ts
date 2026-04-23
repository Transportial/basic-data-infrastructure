// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { PdpDecision, PdpInput, PolicyDecisionPoint } from '../pdp.ts';

// OPA (Open Policy Agent) PDP adapter. Talks to a running OPA server over its
// Data API: `POST <baseUrl>/v1/data/<package>/allow` with `{ input: <PdpInput> }`
// and expects an OPA response `{ result: <decision> }`. The Rego policy writer
// is free to shape the decision; we accept either a boolean (`true` = permit)
// or an object matching `PdpDecision` directly.

export interface OpaAdapterOptions {
  readonly baseUrl: string;
  readonly packagePath: string; // e.g. "bdi/authz"
  readonly rule?: string; // defaults to "allow"
  readonly token?: string; // bearer token if the OPA server is auth-protected
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export class OpaPdp implements PolicyDecisionPoint {
  constructor(private readonly options: OpaAdapterOptions) {}

  async decide(input: PdpInput): Promise<PdpDecision> {
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/v1/data/${this.options.packagePath.replace(/\./g, '/')}/${this.options.rule ?? 'allow'}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 2000);
    let res: Response;
    try {
      res = await fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });
    } catch (e) {
      return { effect: 'deny', reason: `opa-transport:${e instanceof Error ? e.message : 'unknown'}` };
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return { effect: 'deny', reason: `opa-status-${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { effect: 'deny', reason: 'opa-invalid-json' };
    }
    const result = (body as { result?: unknown }).result;
    return coerceDecision(result);
  }
}

function coerceDecision(result: unknown): PdpDecision {
  if (result === true) return { effect: 'permit' };
  if (result === false || result === null || result === undefined)
    return { effect: 'deny', reason: 'opa-rejected' };
  if (typeof result === 'object') {
    const r = result as {
      effect?: 'permit' | 'deny';
      reason?: string;
      obligations?: Array<{ type: string; args: Record<string, string> }>;
    };
    if (r.effect === 'permit') {
      return r.obligations ? { effect: 'permit', obligations: r.obligations } : { effect: 'permit' };
    }
    return { effect: 'deny', reason: r.reason ?? 'opa-rejected' };
  }
  return { effect: 'deny', reason: 'opa-unknown-shape' };
}
