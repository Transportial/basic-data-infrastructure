# ADR-0003: Clean architecture, manual composition root

- Status: accepted
- Date: 2026-04-23

## Context

The domain rules of BDI — the member state machine, chain-context
invariants, BVAD contents — need to be testable and *understandable*
without dragging in a database, an HTTP framework, or a crypto library.
A typical Node service mixes all four, and the result is flaky tests
and refactors that take a week.

We didn't want that.

## Decision

Adopt the classic four-layer split: `domain` → `application` →
`infrastructure` → `interface`. Ports live in `application/ports.ts`;
adapters implement them in `infrastructure/`. Composition happens in a
single `composition-root.ts` per service. No DI framework — the wiring
is plain TypeScript.

## Consequences

What we like about this:

- Wiring is obvious. One file shows exactly what's plugged into what,
  no decorators or runtime container to read around.
- Unit tests run with no adapters — just in-memory fakes from
  `@transportial/testing`.
- Replacing a backend (Postgres → Redis, HMAC → EdDSA / HSM, in-memory
  → Valkey) touches only `infrastructure/` and `composition-root.ts`.

What we accept:

- A little duplication. Each service declares its own router and HTTP
  request types rather than importing from a shared library. We chose
  this deliberately — sharing HTTP types would leak delivery concerns
  back into the application layer.

## What else we considered

- **Nest.js / Awilix / InversifyJS.** Adds a framework dependency for
  no practical gain at our scale. Rejected.
- **Flat architecture.** Easier to write at first, harder to keep
  honest over time. Rejected because the protocol is long-lived and
  will outlast any individual adapter.
