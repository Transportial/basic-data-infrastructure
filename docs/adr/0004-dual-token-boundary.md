# ADR-0004: Dual-token boundary, local validation at CON

- Status: accepted
- Date: 2026-04-23

## Context

A naive design would have CON call ASR or ORS for every data-plane
request. That turns two governance registers into hard dependencies on
the data path, which is exactly what BDI was designed to avoid.

## Decision

BVAD (from ASR) and BVOD (from ORS) are the only cross-service artefacts.
CON validates both offline using a locally-cached trustlist and ORS JWKS.
Neither ASR nor ORS ever answers an allow/deny question during a
data-plane call.

## Consequences

- Data-path latency is independent of ASR/ORS health.
- Revocation takes up to one trustlist-refresh interval (5 minutes with
  Pub/Sub invalidation) to propagate; BVAD lifetime bounds the window to
  10 minutes.
- The trustlist and JWKS become the hot caches — they're small (dozens
  of entries per association) and invalidation is event-driven.
- Requires careful key rotation (see SECURITY.md).

## Alternatives considered

- **Synchronous introspection (RFC 7662)**: kills latency SLOs and
  creates a central dependency. Rejected.
- **Long-lived tokens with custody hygiene**: increases blast radius
  on compromise. Rejected.
