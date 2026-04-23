-- SPDX-License-Identifier: EUPL-1.2
-- CON schema: webhook delivery journal + trustlist cache.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

CREATE TABLE IF NOT EXISTS trustlist_cache (
  issuer TEXT NOT NULL,
  kid TEXT NOT NULL,
  jwk JSONB NOT NULL,
  alg TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (issuer, kid)
);
CREATE INDEX IF NOT EXISTS idx_trustlist_expires ON trustlist_cache (expires_at);
