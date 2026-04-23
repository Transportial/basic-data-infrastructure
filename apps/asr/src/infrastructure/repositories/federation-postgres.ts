// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { Jwk } from '@bdi/kernel';
import { JwkSigner, type KeyAlg } from '@bdi/crypto';
import type {
  FederatedAssociation,
  FederationRegistry,
} from '../../application/use-cases/token-exchange.ts';
import type { SqlPort } from './postgres.ts';

// Postgres-backed FederationRegistry. Peer signing keys are stored as public
// JWKs (verification only) and reconstructed to a RawSigner at load time via
// JwkSigner. Operators who roll a peer's key update the row; the
// TokenExchangeUseCase always looks up by issuer fresh.

export const FEDERATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS federation_peers (
    peer_issuer TEXT PRIMARY KEY,
    peer_kid TEXT NOT NULL,
    peer_alg TEXT NOT NULL CHECK (peer_alg IN ('ES256','ES384','EdDSA','PS256')),
    peer_jwk JSONB NOT NULL,
    association_id TEXT NOT NULL,
    peer_association_id TEXT NOT NULL,
    allow BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_federation_assoc ON federation_peers (association_id);
`;

export interface FederationPeerRecord {
  peer_issuer: string;
  peer_kid: string;
  peer_alg: KeyAlg;
  peer_jwk: Jwk;
  association_id: string;
  peer_association_id: string;
  allow: boolean;
}

export class PostgresFederationRegistry implements FederationRegistry {
  constructor(private readonly sql: SqlPort) {}

  async upsert(record: FederationPeerRecord): Promise<void> {
    await this.sql.exec(
      `INSERT INTO federation_peers (
        peer_issuer, peer_kid, peer_alg, peer_jwk, association_id,
        peer_association_id, allow
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
      ON CONFLICT (peer_issuer) DO UPDATE SET
        peer_kid = EXCLUDED.peer_kid,
        peer_alg = EXCLUDED.peer_alg,
        peer_jwk = EXCLUDED.peer_jwk,
        association_id = EXCLUDED.association_id,
        peer_association_id = EXCLUDED.peer_association_id,
        allow = EXCLUDED.allow,
        updated_at = NOW()`,
      [
        record.peer_issuer,
        record.peer_kid,
        record.peer_alg,
        JSON.stringify(record.peer_jwk),
        record.association_id,
        record.peer_association_id,
        record.allow,
      ],
    );
  }

  async byIssuer(iss: string): Promise<FederatedAssociation | null> {
    const rows = await this.sql.query<PeerRow>(
      `SELECT * FROM federation_peers WHERE peer_issuer = $1`,
      [iss],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    const jwk = (typeof r.peer_jwk === 'string' ? JSON.parse(r.peer_jwk) : r.peer_jwk) as Jwk;
    const signer = new JwkSigner(jwk, r.peer_alg);
    return {
      peer_issuer: r.peer_issuer,
      peer_kid: r.peer_kid,
      peer_signer: signer,
      association_id: r.association_id,
      peer_association_id: r.peer_association_id,
      allow: r.allow,
    };
  }

  async remove(iss: string): Promise<void> {
    await this.sql.exec(`DELETE FROM federation_peers WHERE peer_issuer = $1`, [iss]);
  }
}

interface PeerRow {
  peer_issuer: string;
  peer_kid: string;
  peer_alg: KeyAlg;
  peer_jwk: string | object;
  association_id: string;
  peer_association_id: string;
  allow: boolean;
}
