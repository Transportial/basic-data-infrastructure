# BDI Kerncomponenten — Reference Implementation

[![License: EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-green.svg)](https://joinup.ec.europa.eu/software/page/eupl)

Reference implementation of the three BDI core components specified by Connekt
for the TN-559705 programme:

- **ASR — Associatie Register**: member governance, trustlist, BVAD issuance.
- **ORS — Orkestratie Register**: chain contexts, party involvement, BVOD
  issuance, event dispatch.
- **CON — BDI Connector**: token validation, PEP/PDP, webhook delivery.

The implementation is a TypeScript monorepo targeting [Bun](https://bun.sh/),
arranged for clean architecture and high coverage. Every domain rule is
test-driven; every delivery adapter is replaceable.

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

# Run a single service in development
bun run --filter '@bdi/asr' dev
bun run --filter '@bdi/ors' dev
bun run --filter '@bdi/con' dev
```

See [docs/SETUP.md](docs/SETUP.md) for detailed environment setup, and
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
│   ├── kernel/           # Pure domain primitives (EUPL 1.2)
│   ├── contracts/        # Wire-format schemas (EUPL 1.2 / Apache 2.0)
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

## Design principles

1. **Dual-token boundary** — BVAD (ASR) and BVOD (ORS) are the only cross-service
   artefacts; connectors validate them offline against a cached trustlist.
2. **Clean architecture** — `domain` → `application` → `infrastructure` →
   `interface`. The dependency direction is enforced; composition roots wire
   adapters to ports explicitly.
3. **Postgres is the source of truth, Valkey is the nervous system** — the
   reference implementation ships in-memory adapters that exactly match the
   Port contracts; production replaces them without touching the domain.
4. **Local decisions** — CON runs PEP+PDP locally. Neither ASR nor ORS returns
   a binary allow/deny during a data-plane call; they emit signed facts.
5. **Protocol as code** — `@bdi/contracts` is the single source of truth for
   BVAD/BVOD/trustlist/event shapes. No service re-declares a claim.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — layering, module boundaries, data flow
- [SETUP.md](docs/SETUP.md) — local environment, Docker, dependency graph
- [CONTRIBUTING.md](docs/CONTRIBUTING.md) — branching, commit style, review
- [SECURITY.md](docs/SECURITY.md) — cryptography profile, key management
- [docs/adr/](docs/adr) — Architecture Decision Records

## Licence

Protocol-critical code (kernel, contracts, crypto, policy, events) is released
under **EUPL 1.2**; `@bdi/contracts` is additionally dual-licensed under
**Apache 2.0** to maximise downstream adoption. See [LICENSE](LICENSE).

Copyright (C) 2026 Transportial and contributors.
