# ADR-0002: Monorepo with Bun workspaces

- Status: accepted
- Date: 2026-04-23

## Context

Three services share a protocol (`@bdi/contracts`), a signing profile
(`@bdi/crypto`), a policy engine (`@bdi/policy`), and observability
primitives. Independent repositories would make protocol changes
expensive (multi-repo PRs) and encourage drift.

## Decision

Use a single repository with Bun workspaces. Each service and each
shared package is its own workspace with `@bdi/<name>`. The root
`tsconfig.base.json` declares path mappings so services resolve
`@bdi/kernel` directly to the source — no build step needed in dev.

## Consequences

- Protocol changes are a single PR; incompatibilities caught at compile.
- Shared CI pipeline amortises setup cost.
- Deploying one service is independent (each has its own Dockerfile
  target and own versioning); co-location does not imply coupled deploy.
- Drawback: repo size grows; partial clones are required for large
  contributor deployments (not an issue at the current scale).

## Alternatives considered

- **Polyrepo with git submodules**: high friction, easy to fall out of
  sync. Rejected.
- **Polyrepo with private registry**: forces contract changes to flow
  through a release cycle. Rejected for MVP; revisit after 1.0.
