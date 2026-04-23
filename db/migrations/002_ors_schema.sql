-- SPDX-License-Identifier: EUPL-1.2
-- ORS schema: chain contexts + subscriptions, partitioned by association_id.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chain_contexts (
  id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  orchestrator_euid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order','transport','shipment','custom')),
  status TEXT NOT NULL CHECK (status IN ('planned','active','completed','cancelled')),
  identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  delegations JSONB NOT NULL DEFAULT '[]'::jsonb,
  natural_persons JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (association_id, id)
) PARTITION BY LIST (association_id);
CREATE INDEX IF NOT EXISTS idx_cc_orchestrator ON chain_contexts (orchestrator_euid);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  chain_context_id TEXT NOT NULL,
  subscriber_euid TEXT NOT NULL,
  subscriber_connector_id TEXT NOT NULL,
  event_types JSONB NOT NULL,
  callback_url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (association_id, id)
) PARTITION BY LIST (association_id);
CREATE INDEX IF NOT EXISTS idx_subs_context ON subscriptions (chain_context_id);
CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions (subscriber_euid);

-- Audit journal — partitioned monthly by occurred_at.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT NOT NULL,
  association_id TEXT NOT NULL,
  actor_euid TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events (actor_euid, occurred_at DESC);

ALTER TABLE chain_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_by_assoc ON chain_contexts
  USING (association_id = current_setting('app.association_id', true))
  WITH CHECK (association_id = current_setting('app.association_id', true));

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sub_by_assoc ON subscriptions
  USING (association_id = current_setting('app.association_id', true))
  WITH CHECK (association_id = current_setting('app.association_id', true));
