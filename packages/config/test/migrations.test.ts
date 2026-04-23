// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  MigrationRunner,
  createMigrations,
  type Migration,
  type MigrationSqlPort,
} from '../src/migrations.ts';

class MemorySqlPort implements MigrationSqlPort {
  public readonly ops: string[] = [];
  private readonly rows = new Map<string, string[]>();
  private txDepth = 0;
  public readonly failOn?: string;
  constructor(failOn?: string) {
    this.failOn = failOn;
  }

  async query<T>(sql: string, _params: ReadonlyArray<unknown> = []): Promise<ReadonlyArray<T>> {
    if (/SELECT id FROM schema_migrations/i.test(sql)) {
      const ids = this.rows.get('schema_migrations') ?? [];
      return ids.map((id) => ({ id } as unknown as T));
    }
    return [];
  }

  async exec(sql: string, params: ReadonlyArray<unknown> = []): Promise<{ rowCount: number }> {
    this.ops.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) {
      if (!this.rows.has('schema_migrations')) this.rows.set('schema_migrations', []);
      return { rowCount: 0 };
    }
    if (/INSERT INTO schema_migrations/i.test(sql)) {
      const ids = this.rows.get('schema_migrations') ?? [];
      ids.push(params[0] as string);
      this.rows.set('schema_migrations', ids);
      return { rowCount: 1 };
    }
    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`forced failure: ${this.failOn}`);
    }
    return { rowCount: 0 };
  }

  async tx<T>(fn: (scoped: MigrationSqlPort) => Promise<T>): Promise<T> {
    this.txDepth++;
    const snapshot = new Map<string, string[]>();
    for (const [k, v] of this.rows) snapshot.set(k, [...v]);
    try {
      const r = await fn(this);
      this.txDepth--;
      return r;
    } catch (e) {
      this.rows.clear();
      for (const [k, v] of snapshot) this.rows.set(k, v);
      this.txDepth--;
      throw e;
    }
  }
}

const migs: ReadonlyArray<Migration> = createMigrations([
  { id: '001_init', sql: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)' },
  { id: '002_next', sql: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)' },
  { id: '003_last', sql: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)' },
]);

describe('MigrationRunner', () => {
  test('applies all pending migrations in order', async () => {
    const sql = new MemorySqlPort();
    const runner = new MigrationRunner(sql, migs);
    const { applied } = await runner.runAll();
    expect(applied).toEqual(['001_init', '002_next', '003_last']);
    const doneAgain = await runner.runAll();
    expect(doneAgain.applied).toEqual([]);
  });

  test('skips already-applied migrations', async () => {
    const sql = new MemorySqlPort();
    const r1 = new MigrationRunner(sql, migs.slice(0, 2));
    await r1.runAll();
    const r2 = new MigrationRunner(sql, migs);
    const { applied } = await r2.runAll();
    expect(applied).toEqual(['003_last']);
  });

  test('detects duplicate migration ids at construction', () => {
    expect(() =>
      createMigrations([
        { id: 'dup', sql: 'SELECT 1' },
        { id: 'dup', sql: 'SELECT 2' },
      ]),
    ).toThrow('duplicate migration id: dup');
  });

  test('failed migration leaves schema_migrations unchanged', async () => {
    const sql = new MemorySqlPort('CREATE TABLE IF NOT EXISTS t2');
    const runner = new MigrationRunner(sql, migs);
    await expect(runner.runAll()).rejects.toThrow();
    const applied = await runner.applied();
    expect(applied).toEqual(['001_init']);
  });

  test('logger receives an entry per migration', async () => {
    const sql = new MemorySqlPort();
    const msgs: string[] = [];
    const runner = new MigrationRunner(sql, migs, { logger: (m) => msgs.push(m) });
    await runner.runAll();
    expect(msgs).toEqual(['migrating 001_init', 'migrating 002_next', 'migrating 003_last']);
  });
});
