// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { AssociationId, Euid } from '@bdi/kernel';
import type { Member } from '../../domain/model/member.ts';
import type { Connector } from '../../domain/model/connector.ts';
import type { FourEyesApproval } from '../../domain/model/four-eyes.ts';
import type {
  ApprovalRepository,
  ConnectorRepository,
  MemberRepository,
} from '../../application/ports.ts';

// Postgres adapter built on top of a small SQL port so tests can drive it
// without a running database. The production wiring uses Bun.sql (Postgres
// wire-protocol client shipped with Bun 1.2+); operators who prefer
// node-postgres implement the same port and plug it in.

export interface SqlPort {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rowCount: number }>;
  tx<T>(fn: (scoped: SqlPort) => Promise<T>): Promise<T>;
}

export const POSTGRES_SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    association_id TEXT NOT NULL,
    euid TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    vat_number TEXT,
    lei TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft','verified','activated','suspended','revoked')),
    assurance_level TEXT CHECK (assurance_level IN ('substantial','high') OR assurance_level IS NULL),
    verifications JSONB NOT NULL DEFAULT '[]'::jsonb,
    signing_representative JSONB,
    votes_in_association BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    activated_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    UNIQUE (association_id, euid)
  );
  CREATE INDEX IF NOT EXISTS idx_members_status ON members (association_id, status);
  CREATE INDEX IF NOT EXISTS idx_members_euid ON members (euid);

  CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL UNIQUE,
    kid TEXT NOT NULL,
    jwk JSONB NOT NULL,
    cert_thumbprint TEXT NOT NULL,
    cert_not_after BIGINT NOT NULL,
    callback_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('pending','active','suspended','revoked')),
    bound_on BIGINT NOT NULL,
    authorised_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_connectors_member ON connectors (member_id);
  CREATE INDEX IF NOT EXISTS idx_connectors_kid ON connectors (kid);

  CREATE TABLE IF NOT EXISTS four_eyes_approvals (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('member_activation','connector_registration')),
    subject_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','first','completed','rejected')),
    first_approval JSONB,
    second_approval JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (
      state <> 'completed'
      OR (first_approval IS NOT NULL AND second_approval IS NOT NULL
          AND first_approval->>'by' <> second_approval->>'by')
    )
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_subject ON four_eyes_approvals (subject_type, subject_id);
`;

export class PostgresMemberRepository implements MemberRepository {
  constructor(private readonly sql: SqlPort) {}

  async save(member: Member): Promise<void> {
    await this.sql.exec(
      `INSERT INTO members (
        id, association_id, euid, legal_name, vat_number, lei, status, assurance_level,
        verifications, signing_representative, votes_in_association,
        created_at, activated_at, suspended_at, revoked_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        association_id = EXCLUDED.association_id,
        euid = EXCLUDED.euid,
        legal_name = EXCLUDED.legal_name,
        vat_number = EXCLUDED.vat_number,
        lei = EXCLUDED.lei,
        status = EXCLUDED.status,
        assurance_level = EXCLUDED.assurance_level,
        verifications = EXCLUDED.verifications,
        signing_representative = EXCLUDED.signing_representative,
        votes_in_association = EXCLUDED.votes_in_association,
        activated_at = EXCLUDED.activated_at,
        suspended_at = EXCLUDED.suspended_at,
        revoked_at = EXCLUDED.revoked_at`,
      [
        member.id,
        member.association_id,
        member.euid,
        member.legal_name,
        member.vat_number ?? null,
        member.lei ?? null,
        member.status,
        member.assurance_level ?? null,
        JSON.stringify(member.verifications),
        member.signing_representative ? JSON.stringify(member.signing_representative) : null,
        member.votes_in_association,
        member.created_at,
        member.activated_at,
        member.suspended_at,
        member.revoked_at,
      ],
    );
  }

  async find(id: string): Promise<Member | null> {
    const rows = await this.sql.query<MemberRow>(`SELECT * FROM members WHERE id = $1`, [id]);
    return rows.length > 0 ? rowToMember(rows[0]!) : null;
  }

  async findByEuid(euid: Euid): Promise<Member | null> {
    const rows = await this.sql.query<MemberRow>(`SELECT * FROM members WHERE euid = $1`, [euid]);
    return rows.length > 0 ? rowToMember(rows[0]!) : null;
  }

  async listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    const rows = await this.sql.query<MemberRow>(
      `SELECT * FROM members WHERE association_id = $1`,
      [associationId],
    );
    return rows.map(rowToMember);
  }

  async listActive(associationId: AssociationId): Promise<ReadonlyArray<Member>> {
    const rows = await this.sql.query<MemberRow>(
      `SELECT * FROM members WHERE association_id = $1 AND status = 'activated'`,
      [associationId],
    );
    return rows.map(rowToMember);
  }
}

export class PostgresConnectorRepository implements ConnectorRepository {
  constructor(
    private readonly sql: SqlPort,
    private readonly members: MemberRepository,
  ) {}

  async save(c: Connector): Promise<void> {
    await this.sql.exec(
      `INSERT INTO connectors (
        id, member_id, client_id, kid, jwk, cert_thumbprint, cert_not_after,
        callback_urls, status, bound_on, authorised_by, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        member_id = EXCLUDED.member_id,
        client_id = EXCLUDED.client_id,
        kid = EXCLUDED.kid,
        jwk = EXCLUDED.jwk,
        cert_thumbprint = EXCLUDED.cert_thumbprint,
        cert_not_after = EXCLUDED.cert_not_after,
        callback_urls = EXCLUDED.callback_urls,
        status = EXCLUDED.status,
        bound_on = EXCLUDED.bound_on,
        authorised_by = EXCLUDED.authorised_by`,
      [
        c.id,
        c.member_id,
        c.client_id,
        c.kid,
        JSON.stringify(c.jwk),
        c.cert_thumbprint,
        c.cert_not_after,
        JSON.stringify(c.callback_urls),
        c.status,
        c.bound_on,
        c.authorised_by,
        c.created_at,
      ],
    );
  }

  async find(id: string): Promise<Connector | null> {
    const rows = await this.sql.query<ConnectorRow>(`SELECT * FROM connectors WHERE id = $1`, [id]);
    return rows.length > 0 ? rowToConnector(rows[0]!) : null;
  }

  async findByClientId(clientId: string): Promise<Connector | null> {
    const rows = await this.sql.query<ConnectorRow>(
      `SELECT * FROM connectors WHERE client_id = $1`,
      [clientId],
    );
    return rows.length > 0 ? rowToConnector(rows[0]!) : null;
  }

  async listByMember(memberId: string): Promise<ReadonlyArray<Connector>> {
    const rows = await this.sql.query<ConnectorRow>(
      `SELECT * FROM connectors WHERE member_id = $1`,
      [memberId],
    );
    return rows.map(rowToConnector);
  }

  async listActive(
    associationId: AssociationId,
  ): Promise<ReadonlyArray<{ member: Member; connector: Connector }>> {
    const rows = await this.sql.query<ConnectorRow>(
      `SELECT c.* FROM connectors c JOIN members m ON m.id = c.member_id
       WHERE c.status = 'active' AND m.association_id = $1 AND m.status = 'activated'`,
      [associationId],
    );
    const out: Array<{ member: Member; connector: Connector }> = [];
    for (const row of rows) {
      const connector = rowToConnector(row);
      const member = await this.members.find(connector.member_id);
      if (member) out.push({ member, connector });
    }
    return out;
  }
}

export class PostgresApprovalRepository implements ApprovalRepository {
  constructor(private readonly sql: SqlPort) {}

  async save(a: FourEyesApproval): Promise<void> {
    await this.sql.exec(
      `INSERT INTO four_eyes_approvals (
        id, subject_type, subject_id, state, first_approval, second_approval, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        first_approval = EXCLUDED.first_approval,
        second_approval = EXCLUDED.second_approval`,
      [
        a.id,
        a.subject_type,
        a.subject_id,
        a.state,
        a.first_approval ? JSON.stringify(a.first_approval) : null,
        a.second_approval ? JSON.stringify(a.second_approval) : null,
        a.created_at,
      ],
    );
  }

  async find(id: string): Promise<FourEyesApproval | null> {
    const rows = await this.sql.query<ApprovalRow>(
      `SELECT * FROM four_eyes_approvals WHERE id = $1`,
      [id],
    );
    return rows.length > 0 ? rowToApproval(rows[0]!) : null;
  }

  async findBySubject(
    subject_type: FourEyesApproval['subject_type'],
    subject_id: string,
  ): Promise<FourEyesApproval | null> {
    const rows = await this.sql.query<ApprovalRow>(
      `SELECT * FROM four_eyes_approvals WHERE subject_type = $1 AND subject_id = $2`,
      [subject_type, subject_id],
    );
    return rows.length > 0 ? rowToApproval(rows[0]!) : null;
  }
}

interface MemberRow {
  id: string;
  association_id: string;
  euid: string;
  legal_name: string;
  vat_number: string | null;
  lei: string | null;
  status: Member['status'];
  assurance_level: 'substantial' | 'high' | null;
  verifications: string | object;
  signing_representative: string | object | null;
  votes_in_association: boolean;
  created_at: string;
  activated_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
}

interface ConnectorRow {
  id: string;
  member_id: string;
  client_id: string;
  kid: string;
  jwk: string | object;
  cert_thumbprint: string;
  cert_not_after: number;
  callback_urls: string | object;
  status: Connector['status'];
  bound_on: number;
  authorised_by: string;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  subject_type: FourEyesApproval['subject_type'];
  subject_id: string;
  state: FourEyesApproval['state'];
  first_approval: string | object | null;
  second_approval: string | object | null;
  created_at: string;
}

function rowToMember(r: MemberRow): Member {
  return {
    id: r.id,
    association_id: r.association_id as AssociationId,
    euid: r.euid as Euid,
    legal_name: r.legal_name,
    ...(r.vat_number ? { vat_number: r.vat_number } : {}),
    ...(r.lei ? { lei: r.lei } : {}),
    status: r.status,
    assurance_level: r.assurance_level ?? null,
    verifications: parseJson(r.verifications, []) as Member['verifications'],
    signing_representative: parseJson(r.signing_representative, null) as Member['signing_representative'],
    votes_in_association: r.votes_in_association,
    created_at: r.created_at,
    activated_at: r.activated_at,
    suspended_at: r.suspended_at,
    revoked_at: r.revoked_at,
  };
}

function rowToConnector(r: ConnectorRow): Connector {
  return {
    id: r.id as Connector['id'],
    member_id: r.member_id,
    client_id: r.client_id,
    kid: r.kid,
    jwk: parseJson(r.jwk, {}) as Connector['jwk'],
    cert_thumbprint: r.cert_thumbprint,
    cert_not_after: r.cert_not_after,
    callback_urls: parseJson(r.callback_urls, []) as Connector['callback_urls'],
    status: r.status,
    bound_on: r.bound_on,
    authorised_by: r.authorised_by,
    created_at: r.created_at,
  };
}

function rowToApproval(r: ApprovalRow): FourEyesApproval {
  return {
    id: r.id,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    state: r.state,
    first_approval: parseJson(r.first_approval, null) as FourEyesApproval['first_approval'],
    second_approval: parseJson(r.second_approval, null) as FourEyesApproval['second_approval'],
    created_at: r.created_at,
  };
}

function parseJson<T>(value: string | object | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

// An in-memory SqlPort implementation: runs a very narrow subset of SQL just
// large enough to let the Postgres repositories run end-to-end in unit tests.
// Operators keep the SqlPort interface; production plugs in Bun.sql / pg.
export class InMemorySqlPort implements SqlPort {
  private readonly tables = new Map<string, Record<string, unknown>[]>();

  async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<ReadonlyArray<T>> {
    return this.run<T>(sql, params);
  }

  async exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<{ rowCount: number }> {
    const rows = await this.run(sql, params);
    return { rowCount: rows.length };
  }

  async tx<T>(fn: (scoped: SqlPort) => Promise<T>): Promise<T> {
    // Our fake has no transactional semantics; operators who require them plug
    // in the real Postgres SqlPort. For tests this behaves like autocommit.
    return fn(this);
  }

  private async run<T>(sql: string, params: ReadonlyArray<unknown>): Promise<T[]> {
    const normalised = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT \* FROM (\w+) WHERE id = \$1$/i.test(normalised)) {
      const table = /FROM (\w+)/i.exec(normalised)![1]!;
      const rows = this.tables.get(table) ?? [];
      return rows.filter((r) => r.id === params[0]) as T[];
    }
    if (/^SELECT \* FROM (\w+) WHERE euid = \$1$/i.test(normalised)) {
      const table = /FROM (\w+)/i.exec(normalised)![1]!;
      const rows = this.tables.get(table) ?? [];
      return rows.filter((r) => (r as { euid?: unknown }).euid === params[0]) as T[];
    }
    if (/^SELECT \* FROM (\w+) WHERE client_id = \$1$/i.test(normalised)) {
      const table = /FROM (\w+)/i.exec(normalised)![1]!;
      const rows = this.tables.get(table) ?? [];
      return rows.filter((r) => (r as { client_id?: unknown }).client_id === params[0]) as T[];
    }
    if (/^SELECT \* FROM (\w+) WHERE member_id = \$1$/i.test(normalised)) {
      const table = /FROM (\w+)/i.exec(normalised)![1]!;
      const rows = this.tables.get(table) ?? [];
      return rows.filter((r) => (r as { member_id?: unknown }).member_id === params[0]) as T[];
    }
    if (/^SELECT \* FROM members WHERE association_id = \$1$/i.test(normalised)) {
      const rows = this.tables.get('members') ?? [];
      return rows.filter((r) => r.association_id === params[0]) as T[];
    }
    if (/^SELECT \* FROM members WHERE association_id = \$1 AND status = 'activated'$/i.test(normalised)) {
      const rows = this.tables.get('members') ?? [];
      return rows.filter((r) => r.association_id === params[0] && r.status === 'activated') as T[];
    }
    if (/^SELECT c\.\* FROM connectors c JOIN members m/i.test(normalised)) {
      const connectors = this.tables.get('connectors') ?? [];
      const members = this.tables.get('members') ?? [];
      return connectors.filter((c) => {
        if (c.status !== 'active') return false;
        const m = members.find((mm) => mm.id === (c as { member_id?: unknown }).member_id);
        if (!m) return false;
        return m.association_id === params[0] && m.status === 'activated';
      }) as T[];
    }
    if (
      /^SELECT \* FROM four_eyes_approvals WHERE subject_type = \$1 AND subject_id = \$2$/i.test(
        normalised,
      )
    ) {
      const rows = this.tables.get('four_eyes_approvals') ?? [];
      return rows.filter(
        (r) => r.subject_type === params[0] && r.subject_id === params[1],
      ) as T[];
    }
    if (/^SELECT \* FROM federation_peers WHERE peer_issuer = \$1$/i.test(normalised)) {
      const rows = this.tables.get('federation_peers') ?? [];
      return rows.filter((r) => r.peer_issuer === params[0]) as T[];
    }
    const delMatch = /^DELETE FROM (\w+) WHERE (\w+) = \$1$/i.exec(normalised);
    if (delMatch) {
      const table = delMatch[1]!;
      const column = delMatch[2]!;
      const rows = this.tables.get(table) ?? [];
      const remaining = rows.filter((r) => r[column] !== params[0]);
      this.tables.set(table, remaining);
      return [] as T[];
    }
    const insertMatch = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(normalised);
    if (insertMatch) {
      const table = insertMatch[1]!;
      const cols = insertMatch[2]!.split(',').map((c) => c.trim());
      const values: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        let v = params[i];
        if (typeof v === 'string' && /^\[/.test(v)) {
          try {
            v = JSON.parse(v);
          } catch {
            /* leave as string */
          }
        } else if (typeof v === 'string' && /^\{/.test(v)) {
          try {
            v = JSON.parse(v);
          } catch {
            /* leave */
          }
        }
        values[col] = v;
      });
      const rows = this.tables.get(table) ?? [];
      const pkCol = table === 'federation_peers' ? 'peer_issuer' : 'id';
      const existingIdx = rows.findIndex((r) => r[pkCol] === values[pkCol]);
      if (existingIdx >= 0) rows[existingIdx] = { ...rows[existingIdx], ...values };
      else rows.push(values);
      this.tables.set(table, rows);
      return [] as T[];
    }
    throw new Error(`InMemorySqlPort: unsupported SQL: ${normalised}`);
  }
}
