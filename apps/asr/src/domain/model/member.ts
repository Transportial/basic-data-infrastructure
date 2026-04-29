// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { AssociationId, Euid } from '@transportial/kernel';

export type MemberStatus = 'draft' | 'verified' | 'activated' | 'suspended' | 'revoked';
export type AssuranceLevel = 'substantial' | 'high';
export type AssuranceSource =
  | 'KvK'
  | 'KBO'
  | 'GLEIF'
  | 'VIES'
  | 'eHerkenning'
  | 'manual';

export interface VerificationResult {
  readonly source: AssuranceSource;
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly verified_at: string;
  readonly evidence_hash: string;
}

export interface SigningRepresentative {
  readonly subject_id: string;
  readonly auth_source: 'eHerkenning' | 'eIDAS' | 'manual';
  readonly assurance: AssuranceLevel;
  readonly verified_at: string;
}

export interface Member {
  readonly id: string;
  readonly association_id: AssociationId;
  readonly euid: Euid;
  readonly legal_name: string;
  readonly vat_number?: string;
  readonly lei?: string;
  readonly status: MemberStatus;
  readonly assurance_level: AssuranceLevel | null;
  readonly verifications: ReadonlyArray<VerificationResult>;
  readonly signing_representative: SigningRepresentative | null;
  readonly votes_in_association: boolean;
  readonly created_at: string;
  readonly activated_at: string | null;
  readonly suspended_at: string | null;
  readonly revoked_at: string | null;
}

export interface CreateDraftMemberInput {
  readonly id: string;
  readonly association_id: AssociationId;
  readonly euid: Euid;
  readonly legal_name: string;
  readonly vat_number?: string;
  readonly lei?: string;
  readonly signing_representative: SigningRepresentative | null;
  readonly created_at: string;
}

export function createDraftMember(input: CreateDraftMemberInput): Member {
  return {
    id: input.id,
    association_id: input.association_id,
    euid: input.euid,
    legal_name: input.legal_name,
    ...(input.vat_number !== undefined ? { vat_number: input.vat_number } : {}),
    ...(input.lei !== undefined ? { lei: input.lei } : {}),
    status: 'draft',
    assurance_level: null,
    verifications: [],
    signing_representative: input.signing_representative,
    votes_in_association: false,
    created_at: input.created_at,
    activated_at: null,
    suspended_at: null,
    revoked_at: null,
  };
}
