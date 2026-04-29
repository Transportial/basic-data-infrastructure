# ADR-0004: Dual-token boundary, with local validation at the connector

- Status: accepted
- Date: 2026-04-23

## Context

A naïve design for BDI would have the connector call the ASR or ORS for
every data-plane request — basically a synchronous "is this allowed?"
lookup. That turns two governance registers into hard runtime
dependencies on the data path, which is exactly what BDI was designed
to avoid. If the registers go down, the whole network goes down with
them.

## Decision

The BVAD (issued by the ASR) and the BVOD (issued by the ORS) are the
*only* artefacts that cross service boundaries at runtime. The
connector validates both offline, against a locally cached trustlist
and ORS JWKS. Neither register ever answers an allow/deny question
during a data-plane call.

## Consequences

What this buys us:

- Data-path latency is independent of ASR / ORS health.
- The trustlist and JWKS become hot caches — they're small (dozens of
  entries per association) and invalidation is event-driven via Pub/Sub.

What it costs:

- Revocation isn't instantaneous. A revoked key can still verify until
  the next trustlist refresh — five minutes with our event-driven
  invalidation. The short BVAD lifetime (10 minutes) bounds the
  practical exposure window.
- Key rotation has to be careful and well-rehearsed. See [SECURITY.md](../SECURITY.md).

## What else we considered

- **Synchronous introspection (RFC 7662).** Kills latency SLOs and
  reintroduces the central-dependency problem. Rejected.
- **Long-lived tokens with strict custody hygiene.** Trades latency for
  blast radius on compromise — the wrong end of the trade for our
  threat model. Rejected.
