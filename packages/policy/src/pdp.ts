// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export type AssuranceLevel = 'substantial' | 'high';
export type MemberStatus = 'active' | 'suspended' | 'revoked';

export interface PdpSubject {
  readonly connector_id: string;
  readonly organisation_euid: string;
  readonly assurance: AssuranceLevel;
  readonly status: MemberStatus;
}

export interface PdpContext {
  readonly chain_context_id?: string;
  readonly roles: ReadonlyArray<string>;
  readonly delegated_by?: string;
}

export interface PdpResource {
  readonly type: string;
  readonly id: string;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface PdpInput {
  readonly subject: PdpSubject;
  readonly context: PdpContext;
  readonly action: string;
  readonly resource: PdpResource;
}

export interface Obligation {
  readonly type: string;
  readonly args: Readonly<Record<string, string>>;
}

export type PdpDecision =
  | { readonly effect: 'permit'; readonly obligations?: ReadonlyArray<Obligation> }
  | { readonly effect: 'deny'; readonly reason: string };

export interface PolicyDecisionPoint {
  decide(input: PdpInput): Promise<PdpDecision>;
}
