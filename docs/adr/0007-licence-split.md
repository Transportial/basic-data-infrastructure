# ADR-0007: Licence split — EUPL 1.2 kernel, Apache 2.0 contracts

- Status: superseded by [ADR-0008](0008-relicense-polyform-shield.md)
- Date: 2026-04-23

## Context

This codebase is a public reference implementation, and the goal is for
both public agencies *and* commercial integrators to adopt it. Pure
EUPL 1.2 across the entire repo would protect the core protocol nicely,
but it would also force commercial adopters to release every derived
product they ship — which is a non-starter for many of them, and would
push them towards reimplementing the protocol from scratch instead of
contributing back.

We didn't want to choose between "stays open" and "actually gets used".

## Decision

- **Protocol-critical code** — `kernel`, `crypto`, `crypto-ca`,
  `events`, `policy`, `observability`, and the services themselves —
  ships under **EUPL 1.2**.
- **Protocol contracts** (`@transportial/contracts`) are dual-licensed under
  **EUPL 1.2 *and* Apache 2.0**. Licensees pick at redistribution time.

## Consequences

- Commercial adopters can build on top of `@transportial/contracts` (the wire
  formats, the schemas) without taking on EUPL copyleft obligations.
  That keeps the door open for compatible commercial implementations.
- The behavioural core stays open under EUPL — improvements there flow
  back to everyone.
- Each source file carries an SPDX header identifying its licence(s),
  so the boundary is unambiguous and machine-checkable.
