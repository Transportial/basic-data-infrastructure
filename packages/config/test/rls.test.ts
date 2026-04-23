// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { withRls, type RlsSqlPort } from '../src/rls.ts';

class FakeSql implements RlsSqlPort {
  public readonly executed: string[] = [];
  async query<T>(): Promise<ReadonlyArray<T>> {
    return [];
  }
  async exec(sql: string): Promise<{ rowCount: number }> {
    this.executed.push(sql);
    return { rowCount: 0 };
  }
  async tx<T>(fn: (scoped: RlsSqlPort) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('withRls', () => {
  test('sets association_id on the scoped transaction', async () => {
    const sql = new FakeSql();
    await withRls(sql, { associationId: 'assoc-alpha' }, async (scoped) => {
      await scoped.exec('SELECT 1');
    });
    expect(sql.executed[0]).toBe("SET LOCAL app.association_id = 'assoc-alpha'");
    expect(sql.executed[1]).toBe('SELECT 1');
  });

  test('sets actor_subject and actor_roles when supplied', async () => {
    const sql = new FakeSql();
    await withRls(
      sql,
      { associationId: 'a', actorSubject: 'alice', actorRoles: ['admin', 'operator'] },
      async (scoped) => {
        await scoped.exec('SELECT 2');
      },
    );
    expect(sql.executed.some((s) => s === "SET LOCAL app.actor_subject = 'alice'")).toBe(true);
    expect(sql.executed.some((s) => s === "SET LOCAL app.actor_roles = 'admin,operator'")).toBe(
      true,
    );
  });

  test('rejects missing associationId', async () => {
    const sql = new FakeSql();
    await expect(withRls(sql, { associationId: '' }, async () => undefined)).rejects.toThrow(
      'associationId is required',
    );
  });

  test("rejects associationId with quote (SQL-injection guard)", async () => {
    const sql = new FakeSql();
    await expect(
      withRls(sql, { associationId: "x' OR '1'='1" }, async () => undefined),
    ).rejects.toThrow('unsafe characters');
  });

  test('rejects actorRoles containing a quote', async () => {
    const sql = new FakeSql();
    await expect(
      withRls(
        sql,
        { associationId: 'a', actorRoles: ['admin', "x';--"] },
        async () => undefined,
      ),
    ).rejects.toThrow('unsafe characters');
  });
});
