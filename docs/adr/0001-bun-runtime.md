# ADR-0001: Use Bun as the runtime

- Status: accepted
- Date: 2026-04-23

## Context

We need a TypeScript-native runtime with minimal dependency footprint, a
built-in test runner, and WebCrypto parity. The reference implementation
is expected to be hackable by integrators without Java/Go/.NET toolchains.

## Decision

Standardise on Bun 1.2+ for development, testing, and default production
container images. Node 22+ is a supported alternative for tooling that
cannot run under Bun, but services are not tested under Node.

## Consequences

- Faster dev loop (TypeScript runs directly; cold start < 300 ms).
- Built-in test runner (`bun test`) removes Jest/Vitest dependency.
- Native WebCrypto without polyfills.
- Smaller container images via the official distroless Bun variant.
- Minor risk: Bun's ecosystem is younger than Node; some opentelemetry
  auto-instrumentation doesn't run under Bun. We use manual
  instrumentation in `@bdi/observability`.

## Alternatives considered

- **Node 22** with tsx/vitest: known-stable but adds a runtime-tooling
  gap and measurably slower boot times. Rejected.
- **Deno 2**: good Web standards fidelity but weaker workspace ergonomics
  and smaller ecosystem for the adapters we need. Rejected.
