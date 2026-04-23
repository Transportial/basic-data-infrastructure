// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { Database, type Statement } from 'bun:sqlite';
import type { AssociationId, Euid } from '@bdi/kernel';
import type { Member } from '../../domain/model/member.ts';
import type { Connector } from '../../domain/model/connector.ts';
import type { FourEyesApproval } from '../../domain/model/four-eyes.ts';
import type {
  ApprovalRepository,
  ConnectorRepository,
  MemberRepository,
} from '../../application/ports.ts';

// A fully-working ASR persistence layer backed by SQLite. Production operators
// swap this for a Postgres + Drizzle adapter implementing the same port
// interface; the schema below (JSON columns for nested structures, CHECK
// constraints for enums) translates to Postgres with minor syntactic changes.

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    association_id TEXT NOT NULL,
    euid TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    vat_number TEXT,
    lei TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft','verified','activated','suspended','revoked')),
    assurance_level TEXT CHECK (assurance_level IN ('substantial','high') OR assurance_level IS NULL),
    verifications TEXT NOT NULL DEFAULT '[]',
    signing_representative TEXT,
    votes_in_association INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    activated_at TEXT,
    suspended_at TEXT,
    revoked_at TEXT,
    UNIQUE (association_id, euid)
  );
  CREATE INDEX IF NOT EXISTS idx_members_status ON members (association_id, status);
  CREATE INDEX IF NOT EXISTS idx_members_euid ON members (euid);

  CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL UNIQUE,
    kid TEXT NOT NULL,
    jwk TEXT NOT NULL,
    cert_thumbprint TEXT NOT NULL,
    cert_not_after INTEGER NOT NULL,
    callback_urls TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('pending','active','suspended','revoked')),
    bound_on INTEGER NOT NULL,
    authorised_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_connectors_member ON connectors (member_id);

  CREATE TABLE IF NOT EXISTS four_eyes_approvals (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('member_activation','connector_registration')),
    subject_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','first','completed','rejected')),
    first_approval TEXT,
    second_approval TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_subject ON four_eyes_approvals (subject_type, subject_id);
`;

export class SqliteMemberRepository implements MemberRepository {
  private readonly upsert: Statement;
  private readonly findById: Statement;
  private readonly findByEuidStmt: Statement;
  private readonly listByAssoc: Statement;

  constructor(private readonly db: Database) {
    ensureSchema(db);
    this.upsert = db.prepare(`
      INSERT INTO members (
        id, association_id, euid, legal_name, vat_number, lei, status, assurance_level,
        verifications, signing_representative, votes_in_association,
        created_at, activated_at, suspended_at, revoked_at
      ) VALUES (
        $id, $association_id, $euid, $legal_name, $vat_number, $lei, $status, $assurance_level,
        $verifications, $signing_representative, $votes_in_association,
        $created_at, $activated_at, $suspended_at, $revoked_at
      )
      ON CONFLICT (id) DO UPDATE SET
        association_id = excluded.association_id,
        euid = excluded.euid,
        legal_name = excluded.legal_name,
        vat_number = excluded.vat_number,
        lei = excluded.lei,
        status = excluded.status,
        assurance_level = excluded.assurance_level,
        verifications = excluded.verifications,
        signing_representative = excluded.signing_representative,
        votes_in_association = excluded.votes_in_association,
        activated_at = excluded.activated_at,
        suspended_at = excluded.suspended_at,
        revoked_at = excluded.revoked_at
    `);
    this.findById = db.prepare('SELECT * FROM members WHERE id = $id');
    this.findByEuidStmt = db.prepare('SELECT * FROM members WHERE euid = $euid');
    this.listByAssoc = db.prepare('SELECT * FROM members WHERE association_id = $association_id');
  }

  async save(member: Member): Promise<void> {
    this.upsert.run({
      $id: member.id,
      $association_id: member.association_id,
      $euid: member.euid,
      $legal_name: member.legal_name,
      $vat_number: member.vat_number ?? null,
      $lei: member.lei ?? null,
      $status: member.status,
      $assurance_level: member.assurance_level ?? null,
      $verifications: JSON.stringify(member.verifications),
      $signing_representative: member.signing_representative
        ? JSON.stringify(member.signing_representative)
        : null,
      $votes_in_association: member.votes_in_association ? 1 : 0,
      $created_at: member.created_at,
      $activated_at: member.activated_at,
      $suspended_at: member.suspended_at,
      $revoked_at: member.revoked_at,
    });
  }

  async find(id: string): Promise<Member | null> {
    const row = this.findById.get({ $id: id });
    return row ? rowToMember(row as Record<string, unknown>) : null;
  }

  async findByEuid(euid: Euid): Promise<Member | null> {
    const row = this.findByEuidStmt.get({ $euid: euid });
    return row ? rowToMember(row as Record<string, unknown>) : null;
  }

  async listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    const rows = this.listByAssoc.all({ $association_id: associationId }) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToMember);
  }

  async listActive(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    const rows = this.db
      .prepare("SELECT * FROM members WHERE association_id = $a AND status = 'activated'")
      .all({ $a: associationId }) as Array<Record<string, unknown>>;
    return rows.map(rowToMember);
  }
}

export class SqliteConnectorRepository implements ConnectorRepository {
  private readonly upsert: Statement;
  private readonly findById: Statement;
  private readonly findByClient: Statement;
  private readonly listByMemberStmt: Statement;

  constructor(
    private readonly db: Database,
    private readonly members: MemberRepository,
  ) {
    ensureSchema(db);
    this.upsert = db.prepare(`
      INSERT INTO connectors (
        id, member_id, client_id, kid, jwk, cert_thumbprint, cert_not_after,
        callback_urls, status, bound_on, authorised_by, created_at
      ) VALUES (
        $id, $member_id, $client_id, $kid, $jwk, $cert_thumbprint, $cert_not_after,
        $callback_urls, $status, $bound_on, $authorised_by, $created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        member_id = excluded.member_id,
        client_id = excluded.client_id,
        kid = excluded.kid,
        jwk = excluded.jwk,
        cert_thumbprint = excluded.cert_thumbprint,
        cert_not_after = excluded.cert_not_after,
        callback_urls = excluded.callback_urls,
        status = excluded.status,
        bound_on = excluded.bound_on,
        authorised_by = excluded.authorised_by
    `);
    this.findById = db.prepare('SELECT * FROM connectors WHERE id = $id');
    this.findByClient = db.prepare('SELECT * FROM connectors WHERE client_id = $client_id');
    this.listByMemberStmt = db.prepare('SELECT * FROM connectors WHERE member_id = $member_id');
  }

  async save(c: Connector): Promise<void> {
    this.upsert.run({
      $id: c.id,
      $member_id: c.member_id,
      $client_id: c.client_id,
      $kid: c.kid,
      $jwk: JSON.stringify(c.jwk),
      $cert_thumbprint: c.cert_thumbprint,
      $cert_not_after: c.cert_not_after,
      $callback_urls: JSON.stringify(c.callback_urls),
      $status: c.status,
      $bound_on: c.bound_on,
      $authorised_by: c.authorised_by,
      $created_at: c.created_at,
    });
  }

  async find(id: string): Promise<Connector | null> {
    const row = this.findById.get({ $id: id });
    return row ? rowToConnector(row as Record<string, unknown>) : null;
  }

  async findByClientId(clientId: string): Promise<Connector | null> {
    const row = this.findByClient.get({ $client_id: clientId });
    return row ? rowToConnector(row as Record<string, unknown>) : null;
  }

  async listByMember(memberId: string): Promise<ReadonlyArray<Connector>> {
    const rows = this.listByMemberStmt.all({ $member_id: memberId }) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToConnector);
  }

  async listActive(
    associationId: AssociationId,
  ): Promise<ReadonlyArray<{ member: Member; connector: Connector }>> {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM connectors c
         JOIN members m ON m.id = c.member_id
         WHERE c.status = 'active' AND m.association_id = $a AND m.status = 'activated'`,
      )
      .all({ $a: associationId }) as Array<Record<string, unknown>>;
    const out: Array<{ member: Member; connector: Connector }> = [];
    for (const row of rows) {
      const connector = rowToConnector(row);
      const member = await this.members.find(connector.member_id);
      if (member) out.push({ member, connector });
    }
    return out;
  }
}

export class SqliteApprovalRepository implements ApprovalRepository {
  private readonly upsert: Statement;
  private readonly findById: Statement;
  private readonly findBySubj: Statement;

  constructor(db: Database) {
    ensureSchema(db);
    this.upsert = db.prepare(`
      INSERT INTO four_eyes_approvals (
        id, subject_type, subject_id, state, first_approval, second_approval, created_at
      ) VALUES (
        $id, $subject_type, $subject_id, $state, $first_approval, $second_approval, $created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        state = excluded.state,
        first_approval = excluded.first_approval,
        second_approval = excluded.second_approval
    `);
    this.findById = db.prepare('SELECT * FROM four_eyes_approvals WHERE id = $id');
    this.findBySubj = db.prepare(
      'SELECT * FROM four_eyes_approvals WHERE subject_type = $type AND subject_id = $id',
    );
  }

  async save(a: FourEyesApproval): Promise<void> {
    this.upsert.run({
      $id: a.id,
      $subject_type: a.subject_type,
      $subject_id: a.subject_id,
      $state: a.state,
      $first_approval: a.first_approval ? JSON.stringify(a.first_approval) : null,
      $second_approval: a.second_approval ? JSON.stringify(a.second_approval) : null,
      $created_at: a.created_at,
    });
  }

  async find(id: string): Promise<FourEyesApproval | null> {
    const row = this.findById.get({ $id: id });
    return row ? rowToApproval(row as Record<string, unknown>) : null;
  }

  async findBySubject(
    subject_type: FourEyesApproval['subject_type'],
    subject_id: string,
  ): Promise<FourEyesApproval | null> {
    const row = this.findBySubj.get({ $type: subject_type, $id: subject_id });
    return row ? rowToApproval(row as Record<string, unknown>) : null;
  }
}

export function openSqlite(path = ':memory:'): Database {
  const db = new Database(path);
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database): void {
  db.exec(SCHEMA);
}

function rowToMember(row: Record<string, unknown>): Member {
  return {
    id: row.id as string,
    association_id: row.association_id as AssociationId,
    euid: row.euid as Euid,
    legal_name: row.legal_name as string,
    ...(row.vat_number ? { vat_number: row.vat_number as string } : {}),
    ...(row.lei ? { lei: row.lei as string } : {}),
    status: row.status as Member['status'],
    assurance_level: (row.assurance_level as Member['assurance_level']) ?? null,
    verifications: JSON.parse((row.verifications as string) ?? '[]') as Member['verifications'],
    signing_representative: row.signing_representative
      ? (JSON.parse(row.signing_representative as string) as Member['signing_representative'])
      : null,
    votes_in_association: row.votes_in_association === 1,
    created_at: row.created_at as string,
    activated_at: (row.activated_at as string | null) ?? null,
    suspended_at: (row.suspended_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
  };
}

function rowToConnector(row: Record<string, unknown>): Connector {
  return {
    id: row.id as Connector['id'],
    member_id: row.member_id as string,
    client_id: row.client_id as string,
    kid: row.kid as string,
    jwk: JSON.parse(row.jwk as string) as Connector['jwk'],
    cert_thumbprint: row.cert_thumbprint as string,
    cert_not_after: row.cert_not_after as number,
    callback_urls: JSON.parse((row.callback_urls as string) ?? '[]') as Connector['callback_urls'],
    status: row.status as Connector['status'],
    bound_on: row.bound_on as number,
    authorised_by: row.authorised_by as string,
    created_at: row.created_at as string,
  };
}

function rowToApproval(row: Record<string, unknown>): FourEyesApproval {
  return {
    id: row.id as string,
    subject_type: row.subject_type as FourEyesApproval['subject_type'],
    subject_id: row.subject_id as string,
    state: row.state as FourEyesApproval['state'],
    first_approval: row.first_approval
      ? (JSON.parse(row.first_approval as string) as FourEyesApproval['first_approval'])
      : null,
    second_approval: row.second_approval
      ? (JSON.parse(row.second_approval as string) as FourEyesApproval['second_approval'])
      : null,
    created_at: row.created_at as string,
  };
}
