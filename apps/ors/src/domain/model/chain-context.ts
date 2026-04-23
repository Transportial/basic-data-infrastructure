// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { AssociationId, ChainContextId, Euid } from '@bdi/kernel';

export type ChainContextKind = 'order' | 'transport' | 'shipment' | 'custom';
export type ChainContextStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface ContextIdentifier {
  readonly scheme: string;
  readonly value: string;
}

export interface InvolvedParty {
  readonly member_euid: Euid;
  readonly roles: ReadonlyArray<string>;
  readonly added_at: string;
  readonly added_by_member: Euid;
  readonly valid_from: string;
  readonly valid_until: string | null;
}

export interface Delegation {
  readonly delegator: Euid;
  readonly delegate: Euid;
  readonly action_scope: ReadonlyArray<string>;
  readonly valid_until: string | null;
  readonly authorised_at: string;
}

export interface RolePerson {
  readonly pseudonym: string;
  readonly role: string;
  readonly organisation_euid: Euid;
  readonly valid_from: string;
  readonly valid_until: string | null;
}

export interface ChainContext {
  readonly id: ChainContextId;
  readonly association_id: AssociationId;
  readonly orchestrator_member_id: Euid;
  readonly kind: ChainContextKind;
  readonly identifiers: ReadonlyArray<ContextIdentifier>;
  readonly parties: ReadonlyArray<InvolvedParty>;
  readonly delegations: ReadonlyArray<Delegation>;
  readonly natural_persons: ReadonlyArray<RolePerson>;
  readonly status: ChainContextStatus;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly created_at: string;
}

export interface CreateChainContextInput {
  readonly id: ChainContextId;
  readonly association_id: AssociationId;
  readonly orchestrator_member_id: Euid;
  readonly kind: ChainContextKind;
  readonly identifiers: ReadonlyArray<ContextIdentifier>;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly created_at: string;
}

export function createChainContext(input: CreateChainContextInput): ChainContext {
  const orchestratorParty: InvolvedParty = {
    member_euid: input.orchestrator_member_id,
    roles: ['orchestrator'],
    added_at: input.created_at,
    added_by_member: input.orchestrator_member_id,
    valid_from: input.valid_from,
    valid_until: input.valid_until,
  };
  return {
    id: input.id,
    association_id: input.association_id,
    orchestrator_member_id: input.orchestrator_member_id,
    kind: input.kind,
    identifiers: input.identifiers,
    parties: [orchestratorParty],
    delegations: [],
    natural_persons: [],
    status: 'planned',
    valid_from: input.valid_from,
    valid_until: input.valid_until,
    created_at: input.created_at,
  };
}
