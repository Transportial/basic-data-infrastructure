// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { BdiHarness } from './harness.ts';

// Scenario helpers: small composable building blocks that read like a story
// when chained together inside a test. Each returns the identifiers tests
// commonly care about (member ID, connector ID, context ID...) so subsequent
// steps can refer to them.

export interface OnboardActiveMemberInput {
  readonly euid: string;
  readonly legalName: string;
  readonly approvers?: readonly [string, string];
}

export interface OnboardActiveMemberResult {
  readonly memberId: string;
}

export async function onboardActiveMember(
  harness: BdiHarness,
  input: OnboardActiveMemberInput,
): Promise<OnboardActiveMemberResult> {
  const [a, b] = input.approvers ?? ['alice', 'bob'];

  const created = await harness.asr.post<{ member_id: string }>('/admin/members', {
    euid: input.euid,
    association_id: harness.associationId,
    legal_name: input.legalName,
    signing_representative: {
      subject_id: `rep-${input.euid}`,
      auth_source: 'eHerkenning',
      assurance: 'high',
      verified_at: new Date().toISOString(),
    },
  });
  if (created.status !== 201) {
    throw new Error(
      `onboardActiveMember: create returned ${created.status} body=${created.raw}`,
    );
  }
  const memberId = created.body.member_id;

  const verified = await harness.asr.post(`/admin/members/${memberId}/run-verifications`);
  if (verified.status !== 202) {
    throw new Error(
      `onboardActiveMember: run-verifications returned ${verified.status} body=${verified.raw}`,
    );
  }

  const a1 = await harness.asr.post(`/admin/members/${memberId}/approve`, { approver: a });
  if (a1.status !== 200) {
    throw new Error(`onboardActiveMember: approve(1) returned ${a1.status} body=${a1.raw}`);
  }

  const a2 = await harness.asr.post(`/admin/members/${memberId}/approve`, { approver: b });
  if (a2.status !== 200) {
    throw new Error(`onboardActiveMember: approve(2) returned ${a2.status} body=${a2.raw}`);
  }

  return { memberId };
}

export interface RegisterConnectorInput {
  readonly memberId: string;
  readonly clientId: string;
  readonly authorisedBy?: string;
  readonly callbackUrls?: ReadonlyArray<string>;
  readonly certThumbprint?: string;
  readonly certNotAfter?: number;
  readonly jwk?: Readonly<Record<string, unknown>>;
  readonly kid?: string;
}

export interface RegisterConnectorResult {
  readonly connectorId: string;
}

export async function registerConnector(
  harness: BdiHarness,
  input: RegisterConnectorInput,
): Promise<RegisterConnectorResult> {
  const r = await harness.asr.post<{ connector_id: string }>('/admin/connectors', {
    member_id: input.memberId,
    client_id: input.clientId,
    jwk: input.jwk ?? { kty: 'OKP', crv: 'Ed25519', x: 'placeholder' },
    kid: input.kid ?? `kid-${input.clientId}`,
    cert_thumbprint: input.certThumbprint ?? `tp-${input.clientId}`,
    cert_not_after: input.certNotAfter ?? 9_999_999_999,
    callback_urls: input.callbackUrls ?? [`https://${input.clientId}.example/hook`],
    authorised_by: input.authorisedBy ?? 'rep',
  });
  if (r.status !== 201) {
    throw new Error(`registerConnector: returned ${r.status} body=${r.raw}`);
  }
  // ASR's domain has `activateConnector` but no HTTP route currently wires it,
  // so connectors registered through the public API stay in `pending` and
  // /oauth2/token rejects them. For tests we bridge that gap by flipping the
  // status directly on the in-memory repository — the end state is identical
  // to what an admin activation route would produce.
  const connectorId = r.body.connector_id;
  const stored = await harness.composition.asr.deps.connectors.find(connectorId);
  if (stored && stored.status !== 'active') {
    await harness.composition.asr.deps.connectors.save({ ...stored, status: 'active' });
  }
  return { connectorId };
}

export interface CreateContextInput {
  readonly orchestrator: string;
  readonly kind?: 'order' | 'transport' | 'shipment' | 'custom';
  readonly identifiers?: ReadonlyArray<{ scheme: string; value: string }>;
  readonly validFrom?: string;
  readonly validUntil?: string | null;
}

export interface CreateContextResult {
  readonly chainContextId: string;
}

export async function createChainContext(
  harness: BdiHarness,
  input: CreateContextInput,
): Promise<CreateContextResult> {
  const r = await harness.ors.post<{ chain_context_id: string }>('/contexts', {
    association_id: harness.associationId,
    orchestrator: input.orchestrator,
    kind: input.kind ?? 'shipment',
    identifiers: input.identifiers ?? [],
    valid_from: input.validFrom ?? new Date().toISOString(),
    valid_until: input.validUntil ?? null,
  });
  if (r.status !== 201) {
    throw new Error(`createChainContext: returned ${r.status} body=${r.raw}`);
  }
  return { chainContextId: r.body.chain_context_id };
}

export interface AddPartyInput {
  readonly chainContextId: string;
  readonly actor: string;
  readonly memberEuid: string;
  readonly roles: ReadonlyArray<string>;
}

export async function addParty(harness: BdiHarness, input: AddPartyInput): Promise<void> {
  const r = await harness.ors.post(`/contexts/${input.chainContextId}/parties`, {
    actor: input.actor,
    member_euid: input.memberEuid,
    roles: input.roles,
  });
  if (r.status !== 201) {
    throw new Error(`addParty: returned ${r.status} body=${r.raw}`);
  }
}

export interface PublishEventInput {
  readonly chainContextId: string;
  readonly publisher: string;
  readonly eventType: string;
  readonly payload?: unknown;
}

export async function publishContextEvent(
  harness: BdiHarness,
  input: PublishEventInput,
): Promise<void> {
  const r = await harness.ors.post(`/contexts/${input.chainContextId}/events`, {
    publisher: input.publisher,
    event_type: input.eventType,
    payload: input.payload ?? {},
  });
  if (r.status !== 200) {
    throw new Error(`publishContextEvent: returned ${r.status} body=${r.raw}`);
  }
}
