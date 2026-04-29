# ADR-0002: Monorepo with Bun workspaces

- Status: accepted
- Date: 2026-04-23

## Context

The three BDI services share a *lot* of substance: a protocol
(`@transportial/contracts`), a signing profile (`@transportial/crypto`), a policy engine
(`@transportial/policy`), and observability primitives. If we'd put each service
in its own repository, even a tiny protocol change would mean
choreographing several PRs in lockstep — and protocols that are
expensive to change tend to drift instead.

## Decision

Use a single repository with Bun workspaces. Each service and each
shared package is its own workspace, prefixed `@transportial/<name>`. The root
`tsconfig.base.json` declares path mappings so services resolve
`@transportial/kernel` and friends directly to source — no build step needed in
dev.

## Consequences

What we gain:

- Protocol changes are a single PR; incompatibilities show up at compile
  time, not at runtime in production.
- Shared CI pipeline amortises the setup cost across services.
- Each service still has its own Dockerfile target and version, so
  co-location does not imply coupled deploy.

What we accept:

- The repo grows over time. Partial clones may eventually be useful for
  large contributor deployments — not an issue at the current scale,
  but worth keeping an eye on.

## What else we considered

- **Polyrepo with git submodules.** High friction, easy to fall out of
  sync. Rejected.
- **Polyrepo with a private package registry.** Forces every contract
  change through a release cycle. Rejected for the MVP — worth
  revisiting after 1.0 once the protocol settles.
