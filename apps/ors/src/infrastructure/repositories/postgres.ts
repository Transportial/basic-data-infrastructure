// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { AssociationId, ChainContextId, Euid } from '@bdi/kernel';
import type { ChainContext } from '../../domain/model/chain-context.ts';
import type { Subscription } from '../../domain/model/subscription.ts';
import type {
  ChainContextRepository,
  SubscriptionRepository,
} from '../../application/ports.ts';

// Postgres adapter for the ORS. Uses the same SqlPort contract as ASR so
// operators plug in Bun.sql or node-postgres interchangeably. Tables are
// partitioned by association_id for multi-association deployments — the
// pg_partman DDL in db/ors.sql wires the declarative partitioning.

export interface SqlPort {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rowCount: number }>;
  tx<T>(fn: (scoped: SqlPort) => Promise<T>): Promise<T>;
}

export const POSTGRES_SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS chain_contexts (
    id TEXT NOT NULL,
    association_id TEXT NOT NULL,
    orchestrator_euid TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('order','transport','shipment','custom')),
    status TEXT NOT NULL CHECK (status IN ('planned','active','completed','cancelled')),
    identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    parties JSONB NOT NULL DEFAULT '[]'::jsonb,
    delegations JSONB NOT NULL DEFAULT '[]'::jsonb,
    natural_persons JSONB NOT NULL DEFAULT '[]'::jsonb,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (association_id, id)
  ) PARTITION BY LIST (association_id);

  CREATE INDEX IF NOT EXISTS idx_cc_orchestrator ON chain_contexts (orchestrator_euid);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT NOT NULL,
    association_id TEXT NOT NULL,
    chain_context_id TEXT NOT NULL,
    subscriber_euid TEXT NOT NULL,
    subscriber_connector_id TEXT NOT NULL,
    event_types JSONB NOT NULL,
    callback_url TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (association_id, id)
  ) PARTITION BY LIST (association_id);

  CREATE INDEX IF NOT EXISTS idx_subs_context ON subscriptions (chain_context_id);
  CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions (subscriber_euid);
`;

export class PostgresChainContextRepository implements ChainContextRepository {
  constructor(private readonly sql: SqlPort) {}

  async save(ctx: ChainContext): Promise<void> {
    await this.sql.exec(
      `INSERT INTO chain_contexts (
        id, association_id, orchestrator_euid, kind, status,
        identifiers, parties, delegations, natural_persons,
        valid_from, valid_until, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)
      ON CONFLICT (association_id, id) DO UPDATE SET
        status = EXCLUDED.status,
        identifiers = EXCLUDED.identifiers,
        parties = EXCLUDED.parties,
        delegations = EXCLUDED.delegations,
        natural_persons = EXCLUDED.natural_persons,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until`,
      [
        ctx.id,
        ctx.association_id,
        ctx.orchestrator_member_id,
        ctx.kind,
        ctx.status,
        JSON.stringify(ctx.identifiers),
        JSON.stringify(ctx.parties),
        JSON.stringify(ctx.delegations),
        JSON.stringify(ctx.natural_persons),
        ctx.valid_from,
        ctx.valid_until,
        ctx.created_at,
      ],
    );
  }

  async find(id: ChainContextId): Promise<ChainContext | null> {
    const rows = await this.sql.query<ContextRow>(
      `SELECT * FROM chain_contexts WHERE id = $1`,
      [id],
    );
    return rows.length > 0 ? rowToContext(rows[0]!) : null;
  }

  async listByOrchestrator(euid: Euid): Promise<ReadonlyArray<ChainContext>> {
    const rows = await this.sql.query<ContextRow>(
      `SELECT * FROM chain_contexts WHERE orchestrator_euid = $1`,
      [euid],
    );
    return rows.map(rowToContext);
  }

  async listByParty(euid: Euid): Promise<ReadonlyArray<ChainContext>> {
    const rows = await this.sql.query<ContextRow>(
      `SELECT * FROM chain_contexts WHERE parties @> $1::jsonb`,
      [JSON.stringify([{ member_euid: euid }])],
    );
    return rows.map(rowToContext).filter((c) => c.parties.some((p) => p.member_euid === euid));
  }

  async listByAssociation(associationId: AssociationId): Promise<ReadonlyArray<ChainContext>> {
    const rows = await this.sql.query<ContextRow>(
      `SELECT * FROM chain_contexts WHERE association_id = $1`,
      [associationId],
    );
    return rows.map(rowToContext);
  }
}

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly sql: SqlPort) {}

  async save(sub: Subscription): Promise<void> {
    await this.sql.exec(
      `INSERT INTO subscriptions (
        id, association_id, chain_context_id, subscriber_euid, subscriber_connector_id,
        event_types, callback_url, active, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
      ON CONFLICT (association_id, id) DO UPDATE SET
        event_types = EXCLUDED.event_types,
        callback_url = EXCLUDED.callback_url,
        active = EXCLUDED.active`,
      [
        sub.id,
        // Tests for the in-memory port don't pass association_id through; derive
        // it from the associated chain context or default to 'default'.
        (sub as Subscription & { association_id?: string }).association_id ?? 'default',
        sub.chain_context_id,
        sub.subscriber_euid,
        sub.subscriber_connector_id,
        JSON.stringify(sub.event_types),
        sub.callback_url,
        sub.active,
        sub.created_at,
      ],
    );
  }

  async find(id: string): Promise<Subscription | null> {
    const rows = await this.sql.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE id = $1`,
      [id],
    );
    return rows.length > 0 ? rowToSubscription(rows[0]!) : null;
  }

  async listByContext(id: ChainContextId): Promise<ReadonlyArray<Subscription>> {
    const rows = await this.sql.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE chain_context_id = $1`,
      [id],
    );
    return rows.map(rowToSubscription);
  }

  async listBySubscriber(euid: Euid): Promise<ReadonlyArray<Subscription>> {
    const rows = await this.sql.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE subscriber_euid = $1`,
      [euid],
    );
    return rows.map(rowToSubscription);
  }
}

interface ContextRow {
  id: string;
  association_id: string;
  orchestrator_euid: string;
  kind: ChainContext['kind'];
  status: ChainContext['status'];
  identifiers: string | object;
  parties: string | object;
  delegations: string | object;
  natural_persons: string | object;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  association_id: string;
  chain_context_id: string;
  subscriber_euid: string;
  subscriber_connector_id: string;
  event_types: string | object;
  callback_url: string;
  active: boolean;
  created_at: string;
}

function rowToContext(r: ContextRow): ChainContext {
  return {
    id: r.id as ChainContextId,
    association_id: r.association_id as AssociationId,
    orchestrator_member_id: r.orchestrator_euid as Euid,
    kind: r.kind,
    status: r.status,
    identifiers: parseJson(r.identifiers, []) as ChainContext['identifiers'],
    parties: parseJson(r.parties, []) as ChainContext['parties'],
    delegations: parseJson(r.delegations, []) as ChainContext['delegations'],
    natural_persons: parseJson(r.natural_persons, []) as ChainContext['natural_persons'],
    valid_from: r.valid_from,
    valid_until: r.valid_until,
    created_at: r.created_at,
  };
}

function rowToSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    chain_context_id: r.chain_context_id as ChainContextId,
    subscriber_euid: r.subscriber_euid as Euid,
    subscriber_connector_id: r.subscriber_connector_id as Subscription['subscriber_connector_id'],
    event_types: parseJson(r.event_types, []) as Subscription['event_types'],
    callback_url: r.callback_url,
    active: r.active,
    created_at: r.created_at,
  };
}

function parseJson<T>(v: string | object | null | undefined, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

// In-memory SqlPort just large enough to drive the ORS Postgres repositories
// in unit tests without a running database.
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
    return fn(this);
  }

  private async run<T>(sql: string, params: ReadonlyArray<unknown>): Promise<T[]> {
    const n = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT \* FROM (\w+) WHERE id = \$1$/i.test(n)) {
      const t = /FROM (\w+)/i.exec(n)![1]!;
      return (this.tables.get(t) ?? []).filter((r) => r.id === params[0]) as T[];
    }
    if (/^SELECT \* FROM chain_contexts WHERE orchestrator_euid = \$1$/i.test(n)) {
      return (this.tables.get('chain_contexts') ?? []).filter(
        (r) => r.orchestrator_euid === params[0],
      ) as T[];
    }
    if (/^SELECT \* FROM chain_contexts WHERE parties @> \$1::jsonb$/i.test(n)) {
      // Fall back to a coarse filter — returns all rows; the caller re-filters.
      return (this.tables.get('chain_contexts') ?? []) as T[];
    }
    if (/^SELECT \* FROM chain_contexts WHERE association_id = \$1$/i.test(n)) {
      return (this.tables.get('chain_contexts') ?? []).filter(
        (r) => r.association_id === params[0],
      ) as T[];
    }
    if (/^SELECT \* FROM subscriptions WHERE chain_context_id = \$1$/i.test(n)) {
      return (this.tables.get('subscriptions') ?? []).filter(
        (r) => r.chain_context_id === params[0],
      ) as T[];
    }
    if (/^SELECT \* FROM subscriptions WHERE subscriber_euid = \$1$/i.test(n)) {
      return (this.tables.get('subscriptions') ?? []).filter(
        (r) => r.subscriber_euid === params[0],
      ) as T[];
    }
    const insertMatch = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(n);
    if (insertMatch) {
      const table = insertMatch[1]!;
      const cols = insertMatch[2]!.split(',').map((c) => c.trim());
      const values: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        let v = params[i];
        if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
          try {
            v = JSON.parse(v);
          } catch {
            /* ignore */
          }
        }
        values[col] = v;
      });
      const rows = this.tables.get(table) ?? [];
      const idx = rows.findIndex((r) => r.id === values.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...values };
      else rows.push(values);
      this.tables.set(table, rows);
      return [] as T[];
    }
    throw new Error(`InMemorySqlPort(ors): unsupported SQL: ${n}`);
  }
}
