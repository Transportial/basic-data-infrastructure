// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export type TokenType = 'bvad' | 'member_descriptor' | 'trustlist' | 'federation';

export interface JournalEntry {
  readonly jti: string;
  readonly token_type: TokenType;
  readonly issued_to: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly claims_hash: string;
  readonly revoked_at: string | null;
}

export interface IssuedTokensJournal {
  record(entry: Omit<JournalEntry, 'revoked_at'>): Promise<void>;
  find(jti: string): Promise<JournalEntry | null>;
  revoke(jti: string, at: string): Promise<void>;
  list(since: string): Promise<ReadonlyArray<JournalEntry>>;
}

export class InMemoryTokensJournal implements IssuedTokensJournal {
  private readonly byJti = new Map<string, JournalEntry>();

  async record(entry: Omit<JournalEntry, 'revoked_at'>): Promise<void> {
    this.byJti.set(entry.jti, { ...entry, revoked_at: null });
  }

  async find(jti: string): Promise<JournalEntry | null> {
    return this.byJti.get(jti) ?? null;
  }

  async revoke(jti: string, at: string): Promise<void> {
    const existing = this.byJti.get(jti);
    if (!existing) return;
    this.byJti.set(jti, { ...existing, revoked_at: at });
  }

  async list(since: string): Promise<ReadonlyArray<JournalEntry>> {
    const sinceMs = new Date(since).getTime();
    return [...this.byJti.values()].filter((e) => new Date(e.issued_at).getTime() >= sinceMs);
  }
}

export async function hashClaims(claims: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(sortKeys(claims)));
  const digest = await crypto.subtle.digest('SHA-256', toBuffer(data));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
