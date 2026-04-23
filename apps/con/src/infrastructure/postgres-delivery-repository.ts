// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { DeliveryRepository } from '../application/ports.ts';
import type { WebhookDelivery } from '../domain/webhook.ts';

// Postgres adapter for CON's webhook delivery journal. Uses the same
// SqlPort contract as ASR/ORS. The deliveries table is partitioned by
// created_at month via pg_partman so operators can retain short windows
// (hot partitions) and archive old deliveries.

export interface SqlPort {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rowCount: number }>;
  tx<T>(fn: (scoped: SqlPort) => Promise<T>): Promise<T>;
}

export const DELIVERY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    target_url TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed','dead')),
    last_http_status INT,
    last_error TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (created_at, id)
  ) PARTITION BY RANGE (created_at);

  CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries (status, created_at);
  CREATE INDEX IF NOT EXISTS idx_deliveries_event ON webhook_deliveries (event_id);
`;

export class PostgresDeliveryRepository implements DeliveryRepository {
  constructor(private readonly sql: SqlPort) {}

  async save(d: WebhookDelivery): Promise<void> {
    await this.sql.exec(
      `INSERT INTO webhook_deliveries (
        id, direction, target_url, event_id, event_type, attempts, status,
        last_http_status, last_error, body, created_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (created_at, id) DO UPDATE SET
        attempts = EXCLUDED.attempts,
        status = EXCLUDED.status,
        last_http_status = EXCLUDED.last_http_status,
        last_error = EXCLUDED.last_error,
        completed_at = EXCLUDED.completed_at`,
      [
        d.id,
        d.direction,
        d.target_url,
        d.event_id,
        d.event_type,
        d.attempts,
        d.status,
        d.last_http_status,
        d.last_error,
        d.body,
        d.created_at,
        d.completed_at,
      ],
    );
  }

  async find(id: string): Promise<WebhookDelivery | null> {
    const rows = await this.sql.query<DeliveryRow>(
      `SELECT * FROM webhook_deliveries WHERE id = $1`,
      [id],
    );
    return rows.length > 0 ? rowToDelivery(rows[0]!) : null;
  }

  async listPending(): Promise<ReadonlyArray<WebhookDelivery>> {
    const rows = await this.sql.query<DeliveryRow>(
      `SELECT * FROM webhook_deliveries WHERE status = 'pending'`,
    );
    return rows.map(rowToDelivery);
  }

  async listDead(): Promise<ReadonlyArray<WebhookDelivery>> {
    const rows = await this.sql.query<DeliveryRow>(
      `SELECT * FROM webhook_deliveries WHERE status = 'dead'`,
    );
    return rows.map(rowToDelivery);
  }
}

interface DeliveryRow {
  id: string;
  direction: 'inbound' | 'outbound';
  target_url: string;
  event_id: string;
  event_type: string;
  attempts: number;
  status: WebhookDelivery['status'];
  last_http_status: number | null;
  last_error: string | null;
  body: string;
  created_at: string;
  completed_at: string | null;
}

function rowToDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    direction: r.direction,
    target_url: r.target_url,
    event_id: r.event_id,
    event_type: r.event_type,
    attempts: r.attempts,
    status: r.status,
    last_http_status: r.last_http_status,
    last_error: r.last_error,
    body: r.body,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

// In-memory SqlPort just large enough to exercise the CON Postgres repo in
// unit tests.
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
    if (/^SELECT \* FROM webhook_deliveries WHERE id = \$1$/i.test(n)) {
      return (this.tables.get('webhook_deliveries') ?? []).filter(
        (r) => r.id === params[0],
      ) as T[];
    }
    if (/^SELECT \* FROM webhook_deliveries WHERE status = 'pending'$/i.test(n)) {
      return (this.tables.get('webhook_deliveries') ?? []).filter(
        (r) => r.status === 'pending',
      ) as T[];
    }
    if (/^SELECT \* FROM webhook_deliveries WHERE status = 'dead'$/i.test(n)) {
      return (this.tables.get('webhook_deliveries') ?? []).filter(
        (r) => r.status === 'dead',
      ) as T[];
    }
    const insertMatch = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(n);
    if (insertMatch) {
      const table = insertMatch[1]!;
      const cols = insertMatch[2]!.split(',').map((c) => c.trim());
      const values: Record<string, unknown> = {};
      cols.forEach((col, i) => (values[col] = params[i]));
      const rows = this.tables.get(table) ?? [];
      const idx = rows.findIndex((r) => r.id === values.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...values };
      else rows.push(values);
      this.tables.set(table, rows);
      return [] as T[];
    }
    throw new Error(`InMemorySqlPort(con): unsupported SQL: ${n}`);
  }
}
