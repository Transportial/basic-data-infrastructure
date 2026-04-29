# ADR-0008: Relicense to PolyForm Shield 1.0.0

- Status: accepted
- Date: 2026-04-29
- Supersedes: [ADR-0007](0007-licence-split.md)

## Context

ADR-0007 placed the repository under EUPL 1.2 with `@transportial/contracts`
additionally under Apache 2.0, on the assumption that the project's audience
was logistics-focused and largely public-sector. Two things changed that
assumption:

1. **The framing of the project broadened.** What started as a Dutch
   logistics reference (BDI) is, mechanically, a generic toolkit for
   chain-of-custody data exchange between independent parties — applicable
   to healthcare referrals, financial settlement networks, customs and
   regulatory pipelines, energy-grid coordination, and any other domain
   where multiple organisations share data along a chain. BDI is now
   positioned as the canonical conformance profile, not the whole product.
   The licence needs to fit *all* of those audiences, not just public
   agencies and EU logistics integrators.
2. **EUPL did not actually achieve what we wanted.** The intent of
   ADR-0007 was "open for everyone, copyleft on the protocol-critical
   core". In practice that combination created two distinct problems:
   - **EUPL's reciprocal obligation discouraged commercial embedding.**
     Integrators in *every* domain — logistics, healthcare,
     finance, energy — wanted to embed the ASR/ORS/CON code inside
     larger products without inheriting EUPL on those products, which
     the licence does not permit. Several simply reimplemented from the
     contracts package, defeating the point of shipping a reference.
   - **EUPL did not stop the one outcome we did want to prevent**: a
     third party taking the codebase, hosting it, and offering it as a
     competing product. EUPL's copyleft fires on *distribution*, not on
     *competing service offerings* — so a hosted SaaS clone would have
     been entirely compliant.

The desired posture is closer to: *all use is fine — internal, commercial,
embedded, modified, across any domain — except using this codebase to
build something that competes with it.*

## Decision

- The repository is relicensed under the **PolyForm Shield License 1.0.0**
  (<https://polyformproject.org/licenses/shield/1.0.0>).
- `packages/contracts` retains its **Apache 2.0** option, expressed as the
  SPDX expression `Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0`. The
  motivation here is now broader than under ADR-0007: the wire formats
  must remain unrestricted not only so independent BDI implementations
  can exist, but so that **other-domain conformance profiles** built on
  the same primitives (a healthcare profile, a settlement profile, a
  regulatory-reporting profile, etc.) can be authored and implemented
  by anyone without inheriting the Shield non-compete clause.
- All other source files carry the SPDX header
  `LicenseRef-PolyForm-Shield-1.0.0`.

PolyForm Shield is **source-available, not OSI "open source"**. The README
calls this out explicitly so adopters with OSI-only procurement policies
can request a separate grant rather than discover the constraint after
integration.

## Consequences

- **Commercial use is unrestricted across all target domains.** Internal
  deployments, embedding into a larger product, offering services *built
  on top of* the protocol, all fine — whether the domain is logistics,
  healthcare, finance, energy, regulatory reporting, or anything else.
- **Independent implementations and alternative conformance profiles
  remain unrestricted** via the Apache 2.0 grant on `packages/contracts`.
  The Shield clause applies to this *codebase*, not to the protocol
  family it implements; building a parallel implementation, or defining
  a new domain-specific profile (e.g. a clinical-referral profile reusing
  BVAD/BVOD-shaped envelopes), is explicitly fine.
- **Hosting this code as a substitute SaaS for the reference itself is
  not permitted** without a separate licence. This applies regardless of
  the target industry — a healthcare-rebranded clone or a finance-vertical
  managed service is just as restricted as a logistics one.
- **The Apache 2.0 carve-out on contracts is narrower in scope than the
  former EUPL/Apache dual-licence on the same files** — recipients now
  pick exactly one of the two, rather than being subject to both. The
  practical effect for downstream implementers is unchanged.
- **Public-sector adopters who require an OSI licence will need a
  negotiated grant.** This is more visible now that the audience extends
  beyond EU public-sector logistics teams: healthcare authorities,
  financial regulators, and grid operators each have their own
  procurement constraints that should be addressed case-by-case rather
  than by retrofitting the licence.
- **Existing contributions made under EUPL 1.2 remain validly licensed
  under those terms**; the relicensing applies going forward to the
  combined work as distributed by the project. Future contributors agree
  to the new terms via the inbound clause in `docs/CONTRIBUTING.md`.

## Alternatives considered

- **Stay on EUPL 1.2.** Rejected for the reasons above: it deters the
  commercial embedding pattern that the broader framing depends on, and
  it does not prevent the SaaS-clone scenario it was implicitly
  expected to.
- **Elastic License v2.** Narrower than what we needed — it targets
  hosted managed-service substitution specifically. Shield's "competing
  product" framing covers the SaaS case *and* a packaged commercial
  fork, which matters when adopters span industries with very different
  delivery models (a healthcare-network packaged clone is not obviously
  a "managed service" in the ELv2 sense, but is clearly a "competing
  product" in Shield's).
- **Business Source License 1.1.** Auto-converts to OSS after N years.
  Attractive in principle, but the date-conversion mechanic adds
  operational complexity for adopters across multiple domains, and we
  don't have a clear opinion on the conversion horizon yet. Revisitable
  if a future ADR concludes a fixed conversion date is desirable.
- **Commons Clause + Apache 2.0.** Simple to bolt on, but the "Sell"
  definition is contested and the combination is widely viewed as
  legally rougher than a purpose-built source-available licence.
- **PolyForm Noncommercial 1.0.0.** Considered and rejected — it would
  block precisely the commercial-embedding adoption pattern that the
  broadened framing relies on.
- **PolyForm Perimeter 1.0.0.** Restricts competition with a *specific*
  product the licensor sells. Less suitable here, because the project
  is positioned as a reference implementation across multiple domains
  rather than as a single commercial product.
