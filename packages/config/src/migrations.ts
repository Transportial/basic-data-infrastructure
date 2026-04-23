// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

// Plain SQL migration runner. Tracks applied migrations in a `schema_migrations`
// table and runs any un-applied files in lexical order inside a transaction.
// Intentionally minimal — drizzle-kit style but with zero dependencies so
// operators can invoke it from a Bun script or from the application boot path.

export interface MigrationSqlPort {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rowCount: number }>;
  tx<T>(fn: (scoped: MigrationSqlPort) => Promise<T>): Promise<T>;
}

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export interface MigrationRunnerOptions {
  readonly logger?: (message: string) => void;
}

export class MigrationRunner {
  constructor(
    private readonly sql: MigrationSqlPort,
    private readonly migrations: ReadonlyArray<Migration>,
    private readonly options: MigrationRunnerOptions = {},
  ) {}

  async ensureMigrationsTable(): Promise<void> {
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async applied(): Promise<ReadonlyArray<string>> {
    const rows = await this.sql.query<{ id: string }>(`SELECT id FROM schema_migrations ORDER BY id`);
    return rows.map((r) => r.id);
  }

  async pending(): Promise<ReadonlyArray<Migration>> {
    const done = new Set(await this.applied());
    return [...this.migrations].sort((a, b) => a.id.localeCompare(b.id)).filter((m) => !done.has(m.id));
  }

  async runAll(): Promise<{ applied: ReadonlyArray<string> }> {
    await this.ensureMigrationsTable();
    const pending = await this.pending();
    const applied: string[] = [];
    for (const m of pending) {
      await this.sql.tx(async (scoped) => {
        this.options.logger?.(`migrating ${m.id}`);
        await scoped.exec(m.sql);
        await scoped.exec(`INSERT INTO schema_migrations (id) VALUES ($1)`, [m.id]);
      });
      applied.push(m.id);
    }
    return { applied };
  }
}

// Static migration loader — built up by the app at boot. We intentionally do
// not read from disk here so the runner is trivially testable; service
// composition roots (or CLI) glue `loadMigrationsFromFs` on top when they want
// filesystem-backed loading.
export function createMigrations(entries: ReadonlyArray<Migration>): ReadonlyArray<Migration> {
  const seen = new Set<string>();
  for (const m of entries) {
    if (seen.has(m.id)) throw new Error(`duplicate migration id: ${m.id}`);
    seen.add(m.id);
  }
  return entries;
}
