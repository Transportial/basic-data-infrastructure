-- SPDX-License-Identifier: EUPL-1.2
-- ASR schema: members, connectors, four-eyes approvals, federation peers.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  association_id TEXT NOT NULL,
  euid TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  vat_number TEXT,
  lei TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','verified','activated','suspended','revoked')),
  assurance_level TEXT CHECK (assurance_level IN ('substantial','high') OR assurance_level IS NULL),
  verifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  signing_representative JSONB,
  votes_in_association BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (association_id, euid)
);
CREATE INDEX IF NOT EXISTS idx_members_status ON members (association_id, status);
CREATE INDEX IF NOT EXISTS idx_members_euid ON members (euid);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE,
  kid TEXT NOT NULL,
  jwk JSONB NOT NULL,
  cert_thumbprint TEXT NOT NULL,
  cert_not_after BIGINT NOT NULL,
  callback_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending','active','suspended','revoked')),
  bound_on BIGINT NOT NULL,
  authorised_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connectors_member ON connectors (member_id);
CREATE INDEX IF NOT EXISTS idx_connectors_kid ON connectors (kid);

CREATE TABLE IF NOT EXISTS four_eyes_approvals (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('member_activation','connector_registration')),
  subject_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','first','completed','rejected')),
  first_approval JSONB,
  second_approval JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (
    state <> 'completed'
    OR (first_approval IS NOT NULL AND second_approval IS NOT NULL
        AND first_approval->>'by' <> second_approval->>'by')
  )
);
CREATE INDEX IF NOT EXISTS idx_approvals_subject ON four_eyes_approvals (subject_type, subject_id);

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

-- Tokens journal: partitioned monthly. pg_partman creates child partitions; if
-- pg_partman is unavailable, operators can pre-create partitions manually.
CREATE TABLE IF NOT EXISTS tokens_journal (
  jti TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  subject TEXT NOT NULL,
  audience TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('bvad','member-descriptor','access-token')),
  PRIMARY KEY (issued_at, jti)
) PARTITION BY RANGE (issued_at);
CREATE INDEX IF NOT EXISTS idx_tokens_subject ON tokens_journal (subject, issued_at DESC);

-- RLS: every row is tagged with an association_id and only accessible when the
-- request session has matching SET LOCAL app.association_id.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_by_assoc ON members
  USING (association_id = current_setting('app.association_id', true))
  WITH CHECK (association_id = current_setting('app.association_id', true));
