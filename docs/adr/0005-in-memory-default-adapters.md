# ADR-0005: In-memory default adapters

- Status: accepted
- Date: 2026-04-23

## Context

We had two goals that pull in opposite directions. The reference
implementation needs to boot and pass the full test suite on a fresh
clone — no Docker, no Postgres, no Valkey, just `bun install && bun test`.
At the same time it has to be a credible *starting point* for a real
production deployment, not a toy that gets thrown away the moment
someone gets serious.

## Decision

Ship in-memory repositories, an in-memory event bus, and an in-memory
delivery journal as the default adapters. They implement the same
`application/ports.ts` interfaces as any future Postgres / Valkey
backing. Production adapters plug in via `composition-root.ts` without
touching application code.

The in-memory adapters are not stubs and not test doubles. They're real
implementations of the port contract — they just happen to keep state
in RAM.

## Consequences

The wins:

- Zero-setup onboarding for contributors. `bun install && bun test`
  really does just work.
- The tests that matter — domain rules, use cases, HTTP endpoints —
  run end-to-end with no external services.
- Adapters are designed to be swappable on day one, not retrofitted
  later when "production" becomes a question.

The risk worth managing:

- Someone might deploy the in-memory version to production by accident.
  We mitigate this with explicit documentation in `SETUP.md` and
  separate "production" adapters in `infra/helm/`. If you ever spot a
  way to make the trap less easy to fall into, please open an issue.

## What else we considered

- **Testcontainers.** Requires Docker even for unit tests, which kills
  the "clone and go" experience. Rejected.
- **SQLite as the default.** Simpler than Postgres but still adds
  initialisation complexity. Rejected in favour of a pure in-memory
  default.
