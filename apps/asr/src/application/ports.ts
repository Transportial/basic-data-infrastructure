// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { AssociationId, ClockPort, Euid } from '@bdi/kernel';
import type { Member } from '../domain/model/member.ts';
import type { Connector } from '../domain/model/connector.ts';
import type { FourEyesApproval } from '../domain/model/four-eyes.ts';

export interface MemberRepository {
  save(member: Member): Promise<void>;
  find(id: string): Promise<Member | null>;
  findByEuid(euid: Euid): Promise<Member | null>;
  listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<Member>>;
  listActive(associationId: AssociationId): Promise<ReadonlyArray<Member>>;
}

export interface ConnectorRepository {
  save(connector: Connector): Promise<void>;
  find(id: string): Promise<Connector | null>;
  findByClientId(clientId: string): Promise<Connector | null>;
  listByMember(memberId: string): Promise<ReadonlyArray<Connector>>;
  listActive(associationId: AssociationId): Promise<ReadonlyArray<{ member: Member; connector: Connector }>>;
}

export interface ApprovalRepository {
  save(approval: FourEyesApproval): Promise<void>;
  find(id: string): Promise<FourEyesApproval | null>;
  findBySubject(
    subject_type: FourEyesApproval['subject_type'],
    subject_id: string,
  ): Promise<FourEyesApproval | null>;
}

export interface IdPort {
  newUuid(): string;
}

export interface EventBusPort {
  publish(type: string, associationId: string, body: unknown): Promise<void>;
}

export interface SignerPort {
  signJwt(claims: unknown): Promise<string>;
  readonly kid: string;
}

export interface VerificationSource {
  readonly name: 'KvK' | 'KBO' | 'GLEIF' | 'VIES';
  verify(
    input: { euid: Euid; legal_name: string },
  ): Promise<{ outcome: 'success' | 'failure' | 'partial'; evidence_hash: string }>;
}

export type { ClockPort };
