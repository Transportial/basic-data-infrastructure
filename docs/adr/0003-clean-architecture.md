# ADR-0003: Clean architecture, manual composition root

- Status: accepted
- Date: 2026-04-23

## Context

The domain rules (member state machine, chain-context invariants, BVAD
contents) must be testable and understandable without pulling in a DB,
HTTP, or crypto library. Typical Node services mix all four, making
unit tests flaky and future refactors hard.

## Decision

Adopt the classic four-layer split: `domain` → `application` →
`infrastructure` → `interface`. Ports live in `application/ports.ts`;
adapters implement them in `infrastructure/`. Composition happens in a
single `composition-root.ts` per service. No DI framework.

## Consequences

- Obvious wiring: one file shows exactly what's plugged into what.
- Unit tests run without any adapters via in-memory fakes from
  `@bdi/testing`.
- Replacing a backend (Postgres → Redis, HMAC → EdDSA/HSM, in-memory →
  Valkey) touches only infrastructure and composition-root.
- Slight duplication: each service declares its own router and HTTP
  request types rather than importing from a shared library. This is
  deliberate — shared HTTP types would leak delivery concerns into the
  application layer.

## Alternatives considered

- **Nest.js / Awilix / InversifyJS**: adds framework dependency for no
  gain at our scale. Rejected.
- **Flat architecture**: easier to write, harder to keep clean. Rejected
  because the protocol is long-lived and will outlast individual
  adapters.
