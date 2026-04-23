// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { Database, type Statement } from 'bun:sqlite';
import type { DeliveryRepository } from '../application/ports.ts';
import type { WebhookDelivery, WebhookStatus } from '../domain/webhook.ts';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    target_url TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed','dead')),
    last_http_status INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    body TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_delivery_status ON webhook_deliveries(status);
  CREATE INDEX IF NOT EXISTS idx_delivery_event ON webhook_deliveries(event_id);
`;

export class SqliteDeliveryRepository implements DeliveryRepository {
  private readonly upsertStmt: Statement;
  private readonly findByIdStmt: Statement;
  private readonly listByStatusStmt: Statement;

  constructor(db: Database) {
    ensureSchema(db);
    this.upsertStmt = db.prepare(`
      INSERT INTO webhook_deliveries (
        id, direction, target_url, event_id, event_type, attempts, status,
        last_http_status, last_error, created_at, completed_at, body
      ) VALUES (
        $id, $direction, $target_url, $event_id, $event_type, $attempts, $status,
        $last_http_status, $last_error, $created_at, $completed_at, $body
      )
      ON CONFLICT (id) DO UPDATE SET
        attempts = excluded.attempts,
        status = excluded.status,
        last_http_status = excluded.last_http_status,
        last_error = excluded.last_error,
        completed_at = excluded.completed_at
    `);
    this.findByIdStmt = db.prepare('SELECT * FROM webhook_deliveries WHERE id = $id');
    this.listByStatusStmt = db.prepare('SELECT * FROM webhook_deliveries WHERE status = $status');
  }

  async save(d: WebhookDelivery): Promise<void> {
    this.upsertStmt.run({
      $id: d.id,
      $direction: d.direction,
      $target_url: d.target_url,
      $event_id: d.event_id,
      $event_type: d.event_type,
      $attempts: d.attempts,
      $status: d.status,
      $last_http_status: d.last_http_status ?? null,
      $last_error: d.last_error ?? null,
      $created_at: d.created_at,
      $completed_at: d.completed_at ?? null,
      $body: d.body,
    });
  }

  async find(id: string): Promise<WebhookDelivery | null> {
    const row = this.findByIdStmt.get({ $id: id });
    return row ? rowToDelivery(row as Record<string, unknown>) : null;
  }

  async listPending(): Promise<ReadonlyArray<WebhookDelivery>> {
    return this.listByStatus('pending');
  }

  async listDead(): Promise<ReadonlyArray<WebhookDelivery>> {
    return this.listByStatus('dead');
  }

  private listByStatus(status: WebhookStatus): ReadonlyArray<WebhookDelivery> {
    const rows = this.listByStatusStmt.all({ $status: status }) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToDelivery);
  }
}

export function openDeliveryDb(path = ':memory:'): Database {
  const db = new Database(path);
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database): void {
  db.exec(SCHEMA);
}

function rowToDelivery(row: Record<string, unknown>): WebhookDelivery {
  return {
    id: row.id as string,
    direction: row.direction as WebhookDelivery['direction'],
    target_url: row.target_url as string,
    event_id: row.event_id as string,
    event_type: row.event_type as string,
    attempts: row.attempts as number,
    status: row.status as WebhookStatus,
    last_http_status: (row.last_http_status as number | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    created_at: row.created_at as string,
    completed_at: (row.completed_at as string | null) ?? null,
    body: row.body as string,
  };
}
