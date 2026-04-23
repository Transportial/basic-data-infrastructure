# ADR-0007: Licence split — EUPL 1.2 kernel, Apache 2.0 contracts

- Status: accepted
- Date: 2026-04-23

## Context

The programme requires a public reference implementation. Commercial
integrators asked for a licence that doesn't force them to release
every derived product.

## Decision

- **Protocol-critical code** (`kernel`, `crypto`, `crypto-ca`, `events`,
  `policy`, `observability`, services): **EUPL 1.2**.
- **Protocol contracts** (`@bdi/contracts`): **EUPL 1.2 AND Apache 2.0**
  (licensee chooses at redistribution time).

## Consequences

- Commercial adopters can build atop `@bdi/contracts` without EUPL
  copyleft obligations.
- Core behavioural code stays open.
- Each source file carries an SPDX header identifying the licence(s).
