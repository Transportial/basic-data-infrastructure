// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { PdpDecision, PdpInput, PolicyDecisionPoint } from '../pdp.ts';

// Keycloak Authorization Services adapter. Sends a UMA-compatible
// authorization request to the Keycloak token endpoint and parses the
// response. Keycloak returns a JWT (RPT) on permit or an error JSON on deny;
// we treat a 200 with `access_token` as permit, anything else as deny.

export interface KeycloakAdapterOptions {
  readonly tokenEndpoint: string;
  readonly audience: string; // Keycloak client_id of the protected resource
  readonly subjectTokenFromInput?: (input: PdpInput) => string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export class KeycloakPdp implements PolicyDecisionPoint {
  constructor(private readonly options: KeycloakAdapterOptions) {}

  async decide(input: PdpInput): Promise<PdpDecision> {
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    const subjectToken =
      this.options.subjectTokenFromInput?.(input) ??
      `bdi:connector=${input.subject.connector_id}`;
    const permissions = [`${input.resource.type}#${input.action}`];

    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:uma-ticket');
    body.set('audience', this.options.audience);
    for (const p of permissions) body.append('permission', p);
    body.set('response_mode', 'decision');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 2000);
    let res: Response;
    try {
      res = await fetcher(this.options.tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Bearer ${subjectToken}`,
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (e) {
      return { effect: 'deny', reason: `keycloak-transport:${e instanceof Error ? e.message : 'unknown'}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 200) {
      const json = (await res.json()) as { result?: boolean };
      return json.result === true
        ? { effect: 'permit' }
        : { effect: 'deny', reason: 'keycloak-rejected' };
    }
    if (res.status === 403) return { effect: 'deny', reason: 'keycloak-forbidden' };
    return { effect: 'deny', reason: `keycloak-status-${res.status}` };
  }
}
