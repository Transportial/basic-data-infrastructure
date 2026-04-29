# BDI Kerncomponenten — Reference Implementation

[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/License-PolyForm_Shield_1.0.0-blue.svg)](https://polyformproject.org/licenses/shield/1.0.0)

> A clean, open-source starting point for anyone building on the Basis Data
> Infrastructuur (BDI) — the Dutch framework for trusted data sharing across
> logistics and supply-chain networks.

## What is this, and why should I care?

Modern supply chains move faster than the systems that try to track them.
Carriers, shippers, terminals, customs brokers and platform operators all hold
fragments of the same shipment, but stitching those fragments together is
slow, expensive, and full of one-off integrations.

The **Basis Data Infrastructuur (BDI)** is a Dutch national initiative that
solves this problem the same way the web solved document sharing: not by
forcing everyone onto a single platform, but by agreeing on a small set of
protocols. With BDI, two parties who have never met before can share data
about a shipment **once they prove they belong together in a chain**, with
cryptographic guarantees, without a central middleman holding their data.

This repository is a **reference implementation of the three BDI core
components**. You can run it on your laptop in 60 seconds, point it at your
own data, and use it to:

- Prototype an integration before committing to a vendor.
- Validate your understanding of the BDI specifications.
- Bootstrap a production deployment — the in-memory adapters here are
  drop-in replaceable with Postgres, Valkey, an HSM, and your favourite
  identity provider.

It is **source-available** under the **PolyForm Shield License 1.0.0**:
free to adopt, fork, run internally, and integrate into your own products and
services — including commercially. The one thing it does not allow is using
this codebase to build a product that competes with it. The wire-format
schemas in `@transportial/contracts` are additionally available under
**Apache 2.0**, so anyone can build an independent BDI implementation
against the same protocol.

## The three components, in plain language

BDI splits the responsibility for a data exchange into three small services.
Each does one thing well, and each can be operated by a different party.

### ASR — Associatie Register ("the membership office")

Decides **who is allowed to participate**. New members are onboarded,
verified against authoritative sources (KvK, KBO, GLEIF, VIES), and approved
by two independent administrators ("4-eyes"). Once admitted, a member
receives a signed identity document — a **BVAD** — that other parties can
verify offline against a published trustlist.

### ORS — Orkestratie Register ("the choreographer")

Decides **what happens in a particular chain of custody**. A shipment, a
delegation, a temporary right to act on behalf of someone else — all of these
live in the ORS as *chain contexts*. When a context is set up, the ORS issues
a signed envelope — a **BVOD** — that says "for this specific shipment, these
specific parties may exchange data."

### CON — BDI Connector ("the doorman at each member")

Runs at every participating organisation. When a request comes in, the
connector checks the BVAD (is the caller a real member?), checks the BVOD
(does this exchange belong to a chain we both signed up for?), and asks a
local policy engine for the final allow/deny. Decisions are made **locally**
— neither register is in the data plane.

> **Why the dual-token boundary matters.** Most data-sharing platforms put
> the operator in the middle of every call. BDI deliberately doesn't.
> Connectors verify cryptographic envelopes against a cached trustlist, so
> the registers can be temporarily unreachable without stopping legitimate
> traffic — and they never see the payloads.

## Quick start

```bash
# Install Bun 1.2+ if you don't have it
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Run all tests (hundreds of them, all offline, no external services)
bun test

# Run with coverage
bun test --coverage

# Boot any service in development
bun run --filter '@transportial/asr' dev
bun run --filter '@transportial/ors' dev
bun run --filter '@transportial/con' dev
```

That's it. There is no database to install, no broker to configure, no key
material to generate. The reference adapters are real implementations — they
simply happen to keep state in memory and sign with a symmetric key, so the
test suite is fully self-contained.

When you are ready to go to production, swap the adapters for Postgres,
Valkey Streams, an HSM-backed EdDSA signer and an OIDC/SAML identity
provider. The application and domain layers don't change.

See [docs/SETUP.md](docs/SETUP.md) for a deeper walkthrough, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layered design.

## Repository layout

```
.
├── apps/                 # Deployable services
│   ├── asr/              # Associatie Register
│   ├── ors/              # Orkestratie Register
│   ├── con/              # Connector
│   ├── cli/              # Admin CLI (bdi register-member, approve, ...)
│   └── asr-portal-admin/ # React + Vite admin portal
├── packages/             # Shared libraries
│   ├── kernel/           # Pure domain primitives (PolyForm Shield 1.0.0)
│   ├── contracts/        # Wire-format schemas (PolyForm Shield 1.0.0 / Apache 2.0)
│   ├── crypto/           # BDI JWS profile, RFC 7523 verifier, key generation
│   ├── crypto-ca/        # RFC 8555 ACME server + client, CSR parser, X.509 issuer
│   ├── config/           # Strict env parsing
│   ├── events/           # Typed events + Valkey Streams emulator + rate limiter
│   ├── policy/           # PDP interface + embedded Cedar-like engine
│   ├── observability/    # Structured logs, metrics, trace ctx, OTLP exporter
│   ├── openapi/          # OpenAPI 3.1 document builder
│   └── testing/          # Test fixtures and fakes
├── infra/
│   ├── docker/           # Dockerfiles + Compose (Postgres, Valkey, Keycloak,
│   │                     #   Jaeger, Prometheus, Grafana, portal)
│   └── helm/             # Helm charts (asr, ors, con, bdi-platform umbrella)
└── docs/                 # Architecture, contributing, setup, ADRs
```

## How it's built

A few opinionated choices are worth calling out, because they shape what it
feels like to work on the codebase:

1. **Dual-token boundary.** BVAD (from ASR) and BVOD (from ORS) are the only
   artefacts that cross service boundaries. Connectors validate them offline
   against a cached trustlist; the registers stay out of the data plane.
2. **Clean architecture, enforced.** Every service is layered
   `domain → application → infrastructure → interface`. The dependency
   direction is checked by the test suite, so accidental coupling fails CI
   instead of slipping into production.
3. **Postgres as the source of truth, Valkey as the nervous system.** The
   reference ships in-memory adapters that match the Port contracts exactly;
   production swaps them in without touching domain code.
4. **Local decisions.** The Connector embeds its own policy engine. Neither
   register answers "allow / deny" during a data-plane call — they emit
   signed facts, and each member decides for itself.
5. **Protocol as code.** `@transportial/contracts` is the single source of truth for
   BVAD/BVOD/trustlist/event shapes. No service re-declares a claim, so the
   wire format never drifts.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — layering, module boundaries, data flow
- [SETUP.md](docs/SETUP.md) — local environment, Docker, dependency graph
- [CONTRIBUTING.md](docs/CONTRIBUTING.md) — branching, commit style, review
- [SECURITY.md](docs/SECURITY.md) — cryptography profile, key management
- [docs/adr/](docs/adr) — Architecture Decision Records

## Who is this for?

- **Engineers at logistics platforms, carriers, or terminals** evaluating
  BDI for a real integration.
- **Public-sector teams** working on national or sectoral data spaces.
- **Researchers and students** who want a working, auditable example of a
  modern federated data-sharing protocol.
- **Anyone building on EU data-space concepts** (Gaia-X, IDSA, EONA-X) —
  much of the trust machinery here is directly applicable.

Contributions, questions, and "this surprised me" reports are all welcome.
See [CONTRIBUTING.md](docs/CONTRIBUTING.md) to get involved.

## Licence

This repository is licensed under the **PolyForm Shield License 1.0.0** — a
source-available licence that permits all use (including commercial), with one
exception: you may not use this code to provide a product that competes with
it. See <https://polyformproject.org/licenses/shield/1.0.0> for the full
text and the project's own FAQ.

`@transportial/contracts` (the wire-format schemas for BVAD, BVOD, trustlist
and events) is additionally available under **Apache 2.0** at the licensee's
option, so independent implementations of the BDI protocols are unrestricted.

See [LICENSE](LICENSE) for the canonical text.

> **Note:** PolyForm Shield is *source-available*, not OSI "open source".
> If your procurement policy requires an OSI-approved licence, please get in
> touch — a separate grant can be negotiated.

Copyright (C) 2026 Transportial and contributors.
