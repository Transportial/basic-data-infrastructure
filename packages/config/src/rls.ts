// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

// Postgres Row Level Security helper. Wraps a transaction so every statement
// runs with `SET LOCAL app.association_id = '...'` (and optionally
// `app.actor_subject`), which the policies in the schema use via
// `current_setting('app.association_id', true)`. The settings only live for
// the transaction, so the next request on the same connection is unaffected.

export interface RlsSqlPort {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>>;
  exec(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rowCount: number }>;
  tx<T>(fn: (scoped: RlsSqlPort) => Promise<T>): Promise<T>;
}

export interface RlsContext {
  readonly associationId: string;
  readonly actorSubject?: string;
  readonly actorRoles?: ReadonlyArray<string>;
}

export async function withRls<T>(
  sql: RlsSqlPort,
  ctx: RlsContext,
  fn: (scoped: RlsSqlPort) => Promise<T>,
): Promise<T> {
  if (!ctx.associationId) throw new Error('rls: associationId is required');
  // Reject separator characters that would allow breaking out of the quoted
  // setting value. Settings are applied via SET LOCAL so a quoted literal
  // cannot be parameterised — we validate instead.
  assertSafe(ctx.associationId, 'associationId');
  if (ctx.actorSubject !== undefined) assertSafe(ctx.actorSubject, 'actorSubject');
  return sql.tx(async (scoped) => {
    await scoped.exec(`SET LOCAL app.association_id = '${ctx.associationId}'`);
    if (ctx.actorSubject) {
      await scoped.exec(`SET LOCAL app.actor_subject = '${ctx.actorSubject}'`);
    }
    if (ctx.actorRoles && ctx.actorRoles.length > 0) {
      const joined = ctx.actorRoles.map((r) => {
        assertSafe(r, 'actorRoles');
        return r;
      }).join(',');
      await scoped.exec(`SET LOCAL app.actor_roles = '${joined}'`);
    }
    return fn(scoped);
  });
}

function assertSafe(value: string, label: string): void {
  if (!/^[A-Za-z0-9_:.\-]+$/.test(value)) {
    throw new Error(`rls: ${label} contains unsafe characters`);
  }
}
