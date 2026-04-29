# ADR-0008: Relicense to PolyForm Shield 1.0.0

- Status: accepted
- Date: 2026-04-29
- Supersedes: [ADR-0007](0007-licence-split.md)

## Context

ADR-0007 placed the repository under EUPL 1.2 with `@transportial/contracts`
additionally under Apache 2.0. The intent was "open for everyone, copyleft
on the protocol-critical core". In practice that combination created two
problems:

1. **EUPL's reciprocal obligation discouraged commercial adoption of the
   reference services.** Integrators wanted to embed the ASR/ORS/CON code
   inside larger products without inheriting EUPL on those products,
   which the licence does not permit. Many simply reimplemented from the
   contracts package, defeating the point of shipping a reference.
2. **EUPL did not stop the one outcome we did want to prevent**: a third
   party taking the codebase, hosting it, and offering it as a competing
   product. EUPL's copyleft fires on *distribution*, not on *competing
   service offerings* — so a hosted SaaS clone would have been entirely
   compliant.

The desired posture is closer to: *all use is fine — internal, commercial,
embedded, modified — except using this codebase to build something that
competes with it.*

## Decision

- The repository is relicensed under the **PolyForm Shield License 1.0.0**
  (<https://polyformproject.org/licenses/shield/1.0.0>).
- `packages/contracts` retains its **Apache 2.0** option, expressed as the
  SPDX expression `Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0`. This
  preserves the goal of letting any party implement the BDI wire formats
  without restriction.
- All other source files carry the SPDX header
  `LicenseRef-PolyForm-Shield-1.0.0`.

PolyForm Shield is **source-available, not OSI "open source"**. The README
calls this out explicitly so adopters with OSI-only procurement policies
can request a separate grant rather than discover the constraint after
integration.

## Consequences

- **Commercial use is unrestricted** — internal deployments, embedding
  into a larger product, offering services *built on top of* the BDI
  protocol, all fine.
- **Competing implementations of the BDI protocol remain unrestricted**
  via the Apache 2.0 grant on `packages/contracts`. The Shield clause
  applies to this *codebase*, not to the protocol it implements.
- **Hosting this code as a substitute SaaS for the reference itself is
  not permitted** without a separate licence.
- **The Apache 2.0 carve-out on contracts is narrower in scope than the
  former EUPL/Apache dual-licence on the same files** — recipients now
  pick exactly one of the two, rather than being subject to both. The
  practical effect for downstream implementers is unchanged.
- Public-sector adopters who require an OSI licence will need a
  negotiated grant; this is documented in the README.
- Existing contributions made under EUPL 1.2 remain validly licensed
  under those terms; the relicensing applies going forward to the
  combined work as distributed by the project.

## Alternatives considered

- **Elastic License v2** — narrower than what we needed (targets hosted
  managed-service substitution specifically). Shield's "competing
  product" framing covers the SaaS case *and* a packaged commercial
  fork.
- **Business Source License 1.1** — auto-converts to OSS after N years.
  Attractive, but the date-conversion mechanic adds operational
  complexity for adopters and we don't have a clear opinion on the
  conversion horizon yet.
- **Commons Clause + Apache 2.0** — simple to bolt on, but the "Sell"
  definition is contested and the combination is widely viewed as
  legally rougher than a purpose-built source-available licence.
- **Stay on EUPL 1.2** — does not address the adoption problem above and
  does not actually prevent the SaaS-clone scenario.
