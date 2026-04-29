// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { AssociationId, Euid } from '@transportial/kernel';
import type { Member } from '../../domain/model/member.ts';
import type { Connector } from '../../domain/model/connector.ts';
import type { FourEyesApproval } from '../../domain/model/four-eyes.ts';
import type {
  ApprovalRepository,
  ConnectorRepository,
  MemberRepository,
} from '../../application/ports.ts';

// In-memory adapters are used for unit tests, development, and as the default
// deployment backend when no DATABASE_URL is configured. A production adapter
// (Postgres via Drizzle) implements the same interfaces without affecting the
// domain or application layers — that is the point of ports.
export class InMemoryMemberRepository implements MemberRepository {
  private readonly byId = new Map<string, Member>();

  async save(member: Member): Promise<void> {
    this.byId.set(member.id, member);
  }

  async find(id: string): Promise<Member | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEuid(euid: Euid): Promise<Member | null> {
    for (const m of this.byId.values()) if (m.euid === euid) return m;
    return null;
  }

  async listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    return [...this.byId.values()].filter((m) => m.association_id === associationId);
  }

  async listActive(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    return [...this.byId.values()].filter(
      (m) => m.association_id === associationId && m.status === 'activated',
    );
  }
}

export class InMemoryConnectorRepository implements ConnectorRepository {
  private readonly byId = new Map<string, Connector>();

  constructor(private readonly members: MemberRepository) {}

  async save(connector: Connector): Promise<void> {
    this.byId.set(connector.id, connector);
  }

  async find(id: string): Promise<Connector | null> {
    return this.byId.get(id) ?? null;
  }

  async findByClientId(clientId: string): Promise<Connector | null> {
    for (const c of this.byId.values()) if (c.client_id === clientId) return c;
    return null;
  }

  async listByMember(memberId: string): Promise<ReadonlyArray<Connector>> {
    return [...this.byId.values()].filter((c) => c.member_id === memberId);
  }

  async listActive(
    associationId: AssociationId,
  ): Promise<ReadonlyArray<{ member: Member; connector: Connector }>> {
    const active: Array<{ member: Member; connector: Connector }> = [];
    for (const c of this.byId.values()) {
      if (c.status !== 'active') continue;
      const member = await this.members.find(c.member_id);
      if (!member || member.association_id !== associationId || member.status !== 'activated') continue;
      active.push({ member, connector: c });
    }
    return active;
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly byId = new Map<string, FourEyesApproval>();

  async save(approval: FourEyesApproval): Promise<void> {
    this.byId.set(approval.id, approval);
  }

  async find(id: string): Promise<FourEyesApproval | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySubject(
    subject_type: FourEyesApproval['subject_type'],
    subject_id: string,
  ): Promise<FourEyesApproval | null> {
    for (const a of this.byId.values()) {
      if (a.subject_type === subject_type && a.subject_id === subject_id) return a;
    }
    return null;
  }
}
