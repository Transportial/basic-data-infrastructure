# Changelog

All notable changes to this project will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-23

### Added

- **@bdi/kernel**: pure domain primitives — `Result`, branded types, EUID,
  LEI (ISO 17442), VAT (VIES-compatible), KvK, KBO, AssociationId,
  ConnectorId, ChainContextId, `Clock`, ISO-8601 duration parser, JWK
  validation, BDI JWS profile header validation, RFC 7638 thumbprint.
- **@bdi/contracts**: wire-format schemas for BVAD, BVOD, trustlist, event
  envelope, OAuth client-credentials. Dual-licensed EUPL-1.2 / Apache-2.0.
- **@bdi/config**: strict fail-fast environment parsing.
- **@bdi/observability**: structured logger, Prometheus-compatible
  counters/histograms, W3C Trace Context helpers.
- **@bdi/crypto**: BDI JWS profile compact sign/verify, HMAC-SHA-256
  raw signer, in-memory trustlist resolver.
- **@bdi/events**: typed event producer + in-memory consumer with
  retry/dead-letter classification.
- **@bdi/policy**: `PolicyDecisionPoint` port + Cedar-inspired embedded PDP.
- **@bdi/testing**: `FakeClock`, `FakeSigner`, `FakeEventBus`,
  deterministic id generators.
- **ASR — Associatie Register**:
  - Member lifecycle (`draft → verified → activated → suspended → revoked`)
  - Verification sources (KvK, VIES, GLEIF, KBO) with pluggable `Fetcher`
  - 4-eyes approval with self-approval prevention
  - Connector registration with JWK + callback-URL allowlist validation
  - BVAD issuance (`POST /oauth2/token`) with RFC 7523 request shape
  - Trustlist build + signed JWS at `/.well-known/bdi/trustlist/{assoc}`
  - In-memory repositories matching the Port contracts
- **ORS — Orkestratie Register**:
  - Chain-context aggregate with parties, delegations, pseudonymised
    natural persons
  - Context lifecycle (`planned → active → completed | cancelled`)
  - BVOD issuance with role-derived scopes
  - Event subscriptions (callback allowlist enforced)
  - Event publication with effective-role evaluation
- **CON — BDI Connector**:
  - BVAD + BVOD validation pipeline with ±30s skew tolerance
  - Embedded PDP with default "active + activated" permit policy
  - Outbound webhook delivery with exponential-jitter retry, 408/429/5xx
    retry, 4xx permanent client-error, DLQ
  - Delivery journal
- **Infrastructure**:
  - Shared `Dockerfile.bun` with Alpine-based multi-stage build
  - Development Compose stack for the three services
  - GitHub Actions CI matrix (test + image build)
- **Docs**:
  - `README`, `ARCHITECTURE`, `CONTRIBUTING`, `SETUP`, `SECURITY`
  - ADRs 0001–0007
