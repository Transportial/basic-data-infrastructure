# BDI Kerncomponenten — Reference Implementation

[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/License-PolyForm_Shield_1.0.0-blue.svg)](https://polyformproject.org/licenses/shield/1.0.0)

> A source-available toolkit for **trusted, federated data exchange between
> parties that share a chain of custody** — no central middleman in the data
> plane, no platform lock-in. Implements the Dutch **Basis Data Infrastructuur
> (BDI)** protocol as its canonical conformance profile.

## What is this, and why should I care?

Whenever multiple organisations need to coordinate on the same underlying
*thing* — a shipment, a patient referral, a customs declaration, a financial
settlement, an energy-grid dispatch, a regulatory filing — each party usually
holds a fragment of the truth. Stitching those fragments together is slow,
expensive, and dominated by one-off bilateral integrations.

The pattern that solves it is older than any one industry: agree on a tiny
set of **protocols** instead of forcing everyone onto a single **platform**.
Two parties who have never met before share data about a shared object **once
they prove they belong together in a chain of custody**, with cryptographic
guarantees, and without a central operator sitting in the request path.

This repository implements that pattern. Concretely, it is a reference
implementation of the **Basis Data Infrastructuur (BDI)** — the Dutch national
initiative that originated this design for logistics and supply chains — but
the mechanism (federated identity register, chain-of-custody token issuer,
local policy enforcement at each member) generalises to any domain where:

- Multiple independent parties need to exchange data,
- Membership and counterparty trust must be cryptographically verifiable,
- A specific exchange is bounded by a *chain* (referral pathway, shipment,
  custody chain, transaction graph, regulatory case file), and
- No single party can — for legal, competitive, or operational reasons — be
  the central data hub.

You can run all three components on your laptop in 60 seconds, point them at
your own data, and use this codebase to:

- Prototype a federated integration before committing to a vendor.
- Validate your understanding of the BDI specifications, or use them as a
  starting point for an analogous protocol in a different domain.
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

The protocol splits the responsibility for a data exchange into three small
services. Each does one thing well, and each can be operated by a different
party. The names are BDI's, but the roles are domain-neutral.

### ASR — Associatie Register ("the membership office")

Decides **who is allowed to participate**. New members are onboarded,
verified against authoritative sources, and approved by two independent
administrators ("4-eyes"). Once admitted, a member receives a signed identity
document — a **BVAD** — that other parties can verify offline against a
published trustlist.

The reference implementation ships with verifiers for European legal-entity
registries (**KvK**, **KBO**, **GLEIF**, **VIES**) — natural for BDI's
logistics origin — but the verifier interface is pluggable: swap in a
medical-board lookup, a financial-licence check, an accreditation registry,
or any other authoritative source for the domain you're modelling.

### ORS — Orkestratie Register ("the choreographer")

Decides **what happens in a particular chain**. A shipment, a clinical
referral pathway, a delegated mandate, a multi-leg settlement, a regulatory
case — all of these are modelled as *chain contexts*. When a context is set
up, the ORS issues a signed envelope — a **BVOD** — that says "for this
specific case, these specific parties may exchange data."

### CON — BDI Connector ("the doorman at each member")

Runs at every participating organisation. When a request comes in, the
connector checks the BVAD (is the caller a real member?), checks the BVOD
(does this exchange belong to a chain we both signed up for?), and asks a
local policy engine for the final allow/deny. Decisions are made **locally**
— neither register is in the data plane.

> **Why the dual-token boundary matters.** Most data-sharing platforms put
> the operator in the middle of every call — and therefore see, log, and
> potentially leak every payload. This design deliberately doesn't.
> Connectors verify cryptographic envelopes against a cached trustlist, so
> the registers can be temporarily unreachable without stopping legitimate
> traffic — and they never see the payloads at all.

## Install from npm

The three core services are published to npm under the
[`@transportial`](https://www.npmjs.com/org/transportial) scope and run on
**Node ≥20** or **Bun ≥1.2**.

### Run a service straight from the CLI

Each component ships an executable; `npx` (or `bunx`) boots it without a
permanent install:

```bash
# Associatie Register on :8080
PORT=8080 npx -y @transportial/asr

# Orkestratie Register on :8081
PORT=8081 npx -y @transportial/ors

# Connector on :8443
PORT=8443 npx -y @transportial/con
```

Common environment variables: `PORT`, `ASR_ISSUER`, `ORS_ISSUER`,
`ASSOCIATION_ID`, `CONNECTOR_ID`, `CON_AUDIENCE`. See
[`docs/SETUP.md`](docs/SETUP.md) for the full list and production notes.

### Bootstrap a full association deployment

If you're standing up the registers (ASR + ORS) for a new association rather
than running a single service, the bundled `bdi` CLI generates a complete
deployment directory in one step:

```bash
bunx -p @transportial/cli bdi init-association \
  --id eu.nl.bdi.acme \
  --name "Acme Logistics Association" \
  --domain bdi.acme.example \
  --admin-email ops@acme.example \
  --out ./acme-deploy

cd ./acme-deploy && docker compose up -d
```

The generated directory contains:

- `compose.yml` — Postgres, Valkey, Keycloak, ASR, ORS (member-side
  connectors install separately).
- `.env.asr` and `.env.ors` — pre-filled with the association id, signing
  kid, DB credentials, and issuer URLs.
- `keys/` — freshly generated EdDSA signing JWKs for ASR and ORS.
- `db/init-multi-db.sh` — bootstraps `asr_db` and `ors_db` on first start.
- `admin/bootstrap.json` — single-use credential to claim the first admin
  account in Keycloak.
- `README.md` — exact next-step commands for inviting your first member.

The generator refuses to overwrite an existing deployment, so it's safe to
re-run while you tweak flags. Private signing keys land on disk and are
acceptable for development; for production, swap them for HSM- or PKCS#11-
backed signing as documented in the generated README.

### Embed as a library

```bash
npm install @transportial/asr
# or: bun add @transportial/asr
```

```ts
import { createServer } from '@transportial/asr';

const { fetch, composition } = await createServer({
  port: 8080,
  issuer: 'https://asr.example.org',
});

// Bun
Bun.serve({ port: 8080, fetch });

// Node 20+: any web-fetch adapter, e.g.
// import { createServer as createNodeServer } from 'node:http';
// createNodeServer(yourFetchAdapter(fetch)).listen(8080);
```

`@transportial/ors` and `@transportial/con` expose the same `createServer`
shape. The shared building blocks — `@transportial/kernel`,
`@transportial/contracts`, `@transportial/crypto`, `@transportial/crypto-ca`,
`@transportial/events`, `@transportial/observability`,
`@transportial/identity`, `@transportial/policy`, `@transportial/config`,
`@transportial/testing`, `@transportial/openapi` — are published alongside
and can be consumed independently.

## Quick start (from source)

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
├── packages/                       # Shared libraries
│   ├── kernel/                     # Pure domain primitives (PolyForm Shield 1.0.0)
│   ├── contracts/                  # Wire-format schemas (PolyForm Shield 1.0.0 / Apache 2.0)
│   ├── crypto/                     # BDI JWS profile, RFC 7523 verifier, key generation
│   ├── crypto-ca/                  # RFC 8555 ACME server + client, CSR parser, X.509 issuer
│   ├── config/                     # Strict env parsing
│   ├── events/                     # Typed events + Valkey Streams emulator + rate limiter
│   ├── policy/                     # PDP interface + embedded Cedar-like engine
│   ├── observability/              # Structured logs, metrics, trace ctx, OTLP exporter
│   ├── openapi/                    # OpenAPI 3.1 document builder
│   ├── testing/                    # Test fixtures and fakes
│   ├── recipe-otm/                 # OTM 5.8 connector recipe (Open Transportation Model)
│   ├── recipe-efti/                # eFTI 1.0 connector recipe (EU freight, road)
│   ├── recipe-fhir-r5/             # FHIR R5 connector recipe (referrals, IPS)
│   ├── recipe-mmt-rsm/             # UN/CEFACT MMT-RSM connector recipe (customs, shipping)
│   └── recipe-iso20022-pacs008/    # ISO 20022 pacs.008 connector recipe (settlement)
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

## Domain recipes

The Connector core stays domain-neutral on purpose: BVAD says *who*, BVOD
says *which chain*, the Connector enforces the boundary. **Recipes** are an
optional layer on top — small packages that teach the connector about a
specific data shape, validate inbound payloads against a structural surface,
and surface domain identifiers as PDP resource tags so policy can authorise
on real attributes (e.g. *only consignments tagged for this chain context*,
*only patient summaries whose subject matches the BVOD subject*). Each
recipe ships as a standalone package with its own release cadence and the
same shape: a `compose<X>Recipe(...)` factory returning one or more
`PayloadInspectorPort` instances.

| Package | Domain | Spec |
| --- | --- | --- |
| [`@transportial/recipe-otm`](packages/recipe-otm) | Transport | [OTM 5.8](https://otm-api-spec.redocly.app/api/5.8/otm) — Open Transportation Model |
| [`@transportial/recipe-efti`](packages/recipe-efti) | Freight (EU regulation) | [eFTI](https://eur-lex.europa.eu/eli/reg/2020/1056/oj) — Regulation (EU) 2020/1056 cross-border road common dataset |
| [`@transportial/recipe-fhir-r5`](packages/recipe-fhir-r5) | Healthcare | [FHIR R5](https://hl7.org/fhir/R5/) — clinical referrals + patient-summary exchange |
| [`@transportial/recipe-mmt-rsm`](packages/recipe-mmt-rsm) | Customs / multimodal | [UN/CEFACT MMT-RSM](https://unece.org/trade/uncefact) — multimodal transport reference semantic model |
| [`@transportial/recipe-iso20022-pacs008`](packages/recipe-iso20022-pacs008) | Financial settlement | [ISO 20022 pacs.008](https://www.iso20022.org/) — FI-to-FI customer credit transfer |

```ts
import { composeCon } from '@transportial/con';
import { composeOtmRecipe } from '@transportial/recipe-otm';
import { composeFhirR5Recipe } from '@transportial/recipe-fhir-r5';

const otm = composeOtmRecipe({ pathPrefixes: ['/otm'] });
const fhir = composeFhirR5Recipe({ pathPrefixes: ['/fhir'] });

const con = composeCon({
  asrIssuer: 'https://asr.example.org',
  orsIssuer: 'https://ors.example.org',
  associationId: 'eu.nl.bdi.acme',
  ownConnectorId: 'urn:bdi:connector:me',
  audience: 'urn:bdi:association:eu.nl.bdi.acme',
  inspectors: [...otm.inspectors, ...fhir.inspectors],
});
```

Each recipe ships a small, fast structural validator out of the box and
exposes a `Validator` interface so production deployments can plug in a
full-schema implementation (Ajv against the upstream JSON Schema, an
HL7 profile validator, an XSD-derived JSON Schema, etc.) without changing
the wiring.

See the [recipes catalogue](https://basisdatainfrastructuur.com/recipes.html)
for installation, wiring, and per-recipe details.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — layering, module boundaries, data flow
- [SETUP.md](docs/SETUP.md) — local environment, Docker, dependency graph
- [CONTRIBUTING.md](docs/CONTRIBUTING.md) — branching, commit style, review
- [SECURITY.md](docs/SECURITY.md) — cryptography profile, key management
- [docs/adr/](docs/adr) — Architecture Decision Records

## Who is this for?

- **Logistics, transport, and supply-chain integrators** — the originating
  use case for BDI, and still the most direct fit (carriers, shippers,
  terminals, customs brokers, platform operators).
- **Healthcare and public-health networks** building referral pathways,
  cross-institution patient data exchange, or clinical-research
  collaborations across hospitals, GPs, payers, and regulators.
- **Financial settlement, KYC, and trade-finance networks** where multiple
  institutions need to coordinate on a transaction graph without one party
  becoming the central operator.
- **Energy, utilities, and grid-balancing operators** sharing dispatch,
  metering, or congestion data across TSOs, DSOs, aggregators, and prosumers.
- **Regulatory and compliance reporting** chains — supervisor, supervised
  entity, auditor, sectoral register — where authenticity and provenance
  must be verifiable end-to-end.
- **Public-sector teams** building national or sectoral data spaces, and
  anyone building on **EU data-space concepts** (Gaia-X, IDSA, EONA-X) —
  the trust machinery here maps directly onto those frameworks.
- **Researchers and students** who want a working, auditable example of a
  modern federated data-sharing protocol to study or extend.

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
