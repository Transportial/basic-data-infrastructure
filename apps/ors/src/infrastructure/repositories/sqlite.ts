// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { Database, type Statement } from 'bun:sqlite';
import type { AssociationId, ChainContextId, Euid } from '@transportial/kernel';
import type { ChainContext } from '../../domain/model/chain-context.ts';
import type { Subscription } from '../../domain/model/subscription.ts';
import type {
  ChainContextRepository,
  SubscriptionRepository,
} from '../../application/ports.ts';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS chain_contexts (
    id TEXT PRIMARY KEY,
    association_id TEXT NOT NULL,
    orchestrator_euid TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('order','transport','shipment','custom')),
    status TEXT NOT NULL CHECK (status IN ('planned','active','completed','cancelled')),
    identifiers TEXT NOT NULL DEFAULT '[]',
    parties TEXT NOT NULL DEFAULT '[]',
    delegations TEXT NOT NULL DEFAULT '[]',
    natural_persons TEXT NOT NULL DEFAULT '[]',
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cc_orchestrator ON chain_contexts(orchestrator_euid);
  CREATE INDEX IF NOT EXISTS idx_cc_association ON chain_contexts(association_id);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    chain_context_id TEXT NOT NULL REFERENCES chain_contexts(id) ON DELETE CASCADE,
    subscriber_euid TEXT NOT NULL,
    subscriber_connector_id TEXT NOT NULL,
    event_types TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subs_context ON subscriptions(chain_context_id);
  CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber_euid);
`;

export class SqliteChainContextRepository implements ChainContextRepository {
  private readonly upsertStmt: Statement;
  private readonly findByIdStmt: Statement;
  private readonly byOrchStmt: Statement;
  private readonly byAssocStmt: Statement;
  private readonly allStmt: Statement;

  constructor(db: Database) {
    ensureSchema(db);
    this.upsertStmt = db.prepare(`
      INSERT INTO chain_contexts (
        id, association_id, orchestrator_euid, kind, status, identifiers,
        parties, delegations, natural_persons, valid_from, valid_until, created_at
      ) VALUES (
        $id, $association_id, $orchestrator_euid, $kind, $status, $identifiers,
        $parties, $delegations, $natural_persons, $valid_from, $valid_until, $created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        status = excluded.status,
        identifiers = excluded.identifiers,
        parties = excluded.parties,
        delegations = excluded.delegations,
        natural_persons = excluded.natural_persons,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until
    `);
    this.findByIdStmt = db.prepare('SELECT * FROM chain_contexts WHERE id = $id');
    this.byOrchStmt = db.prepare('SELECT * FROM chain_contexts WHERE orchestrator_euid = $e');
    this.byAssocStmt = db.prepare('SELECT * FROM chain_contexts WHERE association_id = $a');
    this.allStmt = db.prepare('SELECT * FROM chain_contexts');
  }

  async save(ctx: ChainContext): Promise<void> {
    this.upsertStmt.run({
      $id: ctx.id,
      $association_id: ctx.association_id,
      $orchestrator_euid: ctx.orchestrator_member_id,
      $kind: ctx.kind,
      $status: ctx.status,
      $identifiers: JSON.stringify(ctx.identifiers),
      $parties: JSON.stringify(ctx.parties),
      $delegations: JSON.stringify(ctx.delegations),
      $natural_persons: JSON.stringify(ctx.natural_persons),
      $valid_from: ctx.valid_from,
      $valid_until: ctx.valid_until,
      $created_at: ctx.created_at,
    });
  }

  async find(id: ChainContextId): Promise<ChainContext | null> {
    const row = this.findByIdStmt.get({ $id: id });
    return row ? rowToContext(row as Record<string, unknown>) : null;
  }

  async listByOrchestrator(euid: Euid): Promise<ReadonlyArray<ChainContext>> {
    const rows = this.byOrchStmt.all({ $e: euid }) as Array<Record<string, unknown>>;
    return rows.map(rowToContext);
  }

  async listByParty(euid: Euid): Promise<ReadonlyArray<ChainContext>> {
    const all = this.allStmt.all() as Array<Record<string, unknown>>;
    return all
      .map(rowToContext)
      .filter((c) => c.parties.some((p) => p.member_euid === euid));
  }

  async listByAssociation(a: AssociationId): Promise<ReadonlyArray<ChainContext>> {
    const rows = this.byAssocStmt.all({ $a: a }) as Array<Record<string, unknown>>;
    return rows.map(rowToContext);
  }
}

export class SqliteSubscriptionRepository implements SubscriptionRepository {
  private readonly upsertStmt: Statement;
  private readonly findByIdStmt: Statement;
  private readonly byContextStmt: Statement;
  private readonly bySubscriberStmt: Statement;

  constructor(db: Database) {
    ensureSchema(db);
    this.upsertStmt = db.prepare(`
      INSERT INTO subscriptions (
        id, chain_context_id, subscriber_euid, subscriber_connector_id,
        event_types, callback_url, active, created_at
      ) VALUES (
        $id, $chain_context_id, $subscriber_euid, $subscriber_connector_id,
        $event_types, $callback_url, $active, $created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        event_types = excluded.event_types,
        callback_url = excluded.callback_url,
        active = excluded.active
    `);
    this.findByIdStmt = db.prepare('SELECT * FROM subscriptions WHERE id = $id');
    this.byContextStmt = db.prepare('SELECT * FROM subscriptions WHERE chain_context_id = $id');
    this.bySubscriberStmt = db.prepare('SELECT * FROM subscriptions WHERE subscriber_euid = $e');
  }

  async save(sub: Subscription): Promise<void> {
    this.upsertStmt.run({
      $id: sub.id,
      $chain_context_id: sub.chain_context_id,
      $subscriber_euid: sub.subscriber_euid,
      $subscriber_connector_id: sub.subscriber_connector_id,
      $event_types: JSON.stringify(sub.event_types),
      $callback_url: sub.callback_url,
      $active: sub.active ? 1 : 0,
      $created_at: sub.created_at,
    });
  }

  async find(id: string): Promise<Subscription | null> {
    const row = this.findByIdStmt.get({ $id: id });
    return row ? rowToSubscription(row as Record<string, unknown>) : null;
  }

  async listByContext(id: ChainContextId): Promise<ReadonlyArray<Subscription>> {
    const rows = this.byContextStmt.all({ $id: id }) as Array<Record<string, unknown>>;
    return rows.map(rowToSubscription);
  }

  async listBySubscriber(euid: Euid): Promise<ReadonlyArray<Subscription>> {
    const rows = this.bySubscriberStmt.all({ $e: euid }) as Array<Record<string, unknown>>;
    return rows.map(rowToSubscription);
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

function rowToContext(row: Record<string, unknown>): ChainContext {
  return {
    id: row.id as ChainContextId,
    association_id: row.association_id as AssociationId,
    orchestrator_member_id: row.orchestrator_euid as Euid,
    kind: row.kind as ChainContext['kind'],
    status: row.status as ChainContext['status'],
    identifiers: JSON.parse(row.identifiers as string) as ChainContext['identifiers'],
    parties: JSON.parse(row.parties as string) as ChainContext['parties'],
    delegations: JSON.parse(row.delegations as string) as ChainContext['delegations'],
    natural_persons: JSON.parse(row.natural_persons as string) as ChainContext['natural_persons'],
    valid_from: row.valid_from as string,
    valid_until: (row.valid_until as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

function rowToSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    chain_context_id: row.chain_context_id as ChainContextId,
    subscriber_euid: row.subscriber_euid as Euid,
    subscriber_connector_id: row.subscriber_connector_id as Subscription['subscriber_connector_id'],
    event_types: JSON.parse(row.event_types as string) as Subscription['event_types'],
    callback_url: row.callback_url as string,
    active: row.active === 1,
    created_at: row.created_at as string,
  };
}
