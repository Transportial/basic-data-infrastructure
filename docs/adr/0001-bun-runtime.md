# ADR-0001: Use Bun as the runtime

- Status: accepted
- Date: 2026-04-23

## What this is about

Choosing the runtime is the kind of decision that quietly shapes
everything else — from how fast the test loop feels to which crypto
primitives we have to polyfill. We wanted to make this choice
deliberately, so this ADR captures the reasoning.

## Context

We needed a TypeScript-native runtime with a minimal dependency
footprint, a built-in test runner, and full WebCrypto parity. One of the
goals of this reference implementation is that integrators should be
able to clone, hack, and run it without learning a new toolchain — and
in particular without dragging in Java, Go, or .NET dependencies.

## Decision

Standardise on Bun 1.2+ for development, testing, and the default
production container images. Node 22+ remains a supported alternative
for tooling that can't run under Bun, but the services themselves are
not tested under Node.

## Consequences

The good:

- Faster dev loop. TypeScript runs directly; cold start is under 300 ms.
- Built-in test runner (`bun test`) — no Jest or Vitest dependency.
- Native WebCrypto, no polyfills.
- Smaller container images via the official distroless Bun variant.

The trade-off worth flagging:

- Bun's ecosystem is younger than Node's. Some opentelemetry
  auto-instrumentation doesn't run under Bun, so we use manual
  instrumentation in `@transportial/observability`. This is a one-time cost,
  but worth knowing about up front.

## What else we considered

- **Node 22** with `tsx` and `vitest`. Known-stable, but adds a
  runtime/tooling gap and noticeably slower boot times. Rejected.
- **Deno 2.** Excellent web-standards fidelity, but weaker workspace
  ergonomics and a smaller ecosystem for the adapters we need.
  Rejected.
