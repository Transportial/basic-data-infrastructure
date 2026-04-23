# ADR-0005: In-memory default adapters

- Status: accepted
- Date: 2026-04-23

## Context

The reference implementation must boot and pass the full test suite on a
fresh clone, without Docker, Postgres, or Valkey. Yet it must also be a
credible starting point for a production deployment.

## Decision

Ship in-memory repositories, event bus, and delivery journal as the
default adapters. They implement the same `application/ports.ts`
interfaces as any future Postgres / Valkey backing. Production
adapters plug in via `composition-root.ts` without touching application
code.

## Consequences

- Zero-setup onboarding for contributors.
- The tests that matter (domain rules, use cases, HTTP endpoints) run
  end-to-end with no external services.
- Adapters are designed to be swappable: the in-memory implementation
  is not a stub but a real implementation of the port contract.
- Risk: someone may deploy the in-memory version to production. We
  mitigate with clear docs (`SETUP.md`) and explicit "production"
  adapters in `infra/helm/`.

## Alternatives considered

- **Testcontainers**: requires Docker even for unit tests. Rejected.
- **SQLite as default**: simpler than Postgres but still adds
  initialisation complexity; rejected in favour of a pure in-memory
  default.
