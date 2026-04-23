# Architecture

This document describes the layered architecture, the inter-service
communication model, and the key trade-offs made in the reference
implementation.

## 1. Big-picture

```
    ┌─────────────┐       trustlist, federation      ┌─────────────┐
    │             │◀─────────────────────────────────│             │
    │     ASR     │                                  │   Peer ASR  │
    │             │──────── RFC 8693 exchange ──────▶│             │
    └──────┬──────┘                                  └─────────────┘
           │ events (Valkey Streams in prod;
           │ in-memory EventBusPort in reference)
           │
    ┌──────▼──────┐                                  ┌─────────────┐
    │     ORS     │                                  │    OIDC     │
    │             │                                  │  (Keycloak) │
    └──────┬──────┘                                  └──────▲──────┘
           │                                                │
           │                                                │ SAML / OIDC
    ┌──────▼──────┐                                  ┌──────┴──────┐
    │  Connector  │◀──── data plane (BVAD+BVOD) ─────│  Connector  │
    │  (consumer) │                                  │  (provider) │
    └─────────────┘                                  └─────────────┘
```

The reference implementation ships in-memory adapters for repositories,
event bus, and signer backed by HMAC-SHA-256. These are complete,
production-grade implementations of the Port contracts — they just store
state in memory and sign with a symmetric key so the tests can run offline.
Swap them for a Drizzle/Postgres adapter, a Valkey-Streams producer, and
an EdDSA/HSM signer without touching the application layer.

## 2. Clean architecture layers

Each service follows the same four-layer structure:

```
apps/<svc>/src/
├── domain/            # Layer 1 — pure business rules
│   ├── model/         #   Entities, value objects, aggregates
│   └── *.ts           #   Transition functions returning Result<T, E>
├── application/       # Layer 2 — use cases and ports
│   ├── ports.ts       #   Interfaces — the service's outward dependencies
│   └── use-cases/     #   One class per use case (verb-driven names)
├── infrastructure/    # Layer 3 — adapters
│   ├── repositories/  #   Concrete Repository implementations
│   ├── crypto/        #   Signers
│   └── …              #   External clients (HTTP, etc.)
└── interface/         # Layer 4 — delivery
    └── http/          #   Router, route handlers
```

The dependency rule is strictly enforced by convention and by the test suite:

| Layer           | May import from                                     |
|-----------------|-----------------------------------------------------|
| domain          | nothing (no Node built-ins that do I/O)             |
| application     | domain + shared packages (`@bdi/kernel`, etc.)      |
| infrastructure  | domain + application                                |
| interface       | application                                         |
| composition-root| everything (the only file allowed to cross layers)  |

Ports live in `application/ports.ts`; adapters implement those ports in
`infrastructure/`. Use cases never import from `infrastructure`.

## 3. The three services

### ASR — Associatie Register

- **Aggregates**: `Member`, `Connector`, `FourEyesApproval`.
- **Use cases**: onboarding, verifications (KvK/KBO/GLEIF/VIES),
  4-eyes approval, connector registration, BVAD issuance, trustlist build.
- **External integrations** (pluggable via ports): KvK, KBO, GLEIF, VIES,
  Keycloak/eHerkenning, CA (ACME server interface defined in
  `@bdi/crypto-ca`, swappable between local, step-ca, and PKCS#11).

### ORS — Orkestratie Register

- **Aggregate**: `ChainContext` with parties, delegations, natural-person
  pseudonyms.
- **Use cases**: context creation, party management, delegation, BVOD
  issuance, subscriptions, event publication.
- **Privacy invariant**: natural-person PII never leaves the member —
  the ORS stores only a deterministic pseudonym (see
  `src/domain/pseudonym.ts`).

### CON — Connector

- **Responsibilities**: validate BVAD + BVOD on inbound requests, evaluate
  local PEP/PDP, dispatch outbound webhooks with exponential backoff, DLQ.
- **Token verification pipeline** (see `application/use-cases/verify-incoming.ts`):
  1. BVAD signature (via trustlist)
  2. BVAD claim timing / issuer / audience / association / status
  3. BVOD signature (via ORS trust store)
  4. BVOD claim timing / audience / subject connector
  5. PDP decision

## 4. Shared packages

| Package             | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| `@bdi/kernel`       | Value objects (EUID, LEI, VAT, KvK, KBO, AssociationId, ConnectorId, ChainContextId), `Result`, `Clock`, BDI JWS header profile, JWK + thumbprint helpers. |
| `@bdi/contracts`    | Wire-format schemas (BVAD, BVOD, trustlist, OAuth, event envelope).     |
| `@bdi/crypto`       | BDI JWS sign/verify, HMAC signer, in-memory trustlist resolver.         |
| `@bdi/config`       | Fail-fast environment-variable parsing with typed errors.                |
| `@bdi/events`       | `EnvelopeProducer`, `InMemoryConsumer` with retry/DLQ classification.    |
| `@bdi/policy`       | `PolicyDecisionPoint` port + Cedar-inspired embedded PDP.                |
| `@bdi/observability`| Structured logger, Prometheus-compatible registry, trace context.       |
| `@bdi/testing`      | Fake event bus, fake signer, deterministic id generator.                 |

## 5. Inter-service communication

The reference implementation ships an in-memory event bus per service.
Production swaps it for a Valkey Streams adapter (that's the purpose of the
`EventBusPort` interface in `application/ports.ts`).

Envelope shape (`@bdi/contracts/events/envelope`):

```ts
interface EventEnvelope<T> {
  id: string;                // ULID
  occurred_at: string;       // ISO-8601
  producer: { service, instance, version };
  association_id: string;
  type: string;              // namespaced, e.g. asr.member.activated
  schema_version: 1;
  trace: { trace_id, span_id };
  body: T;
  signature?: { jws, kid };  // required when crossing trust boundaries
}
```

| Event                             | Emitter | Consumers          |
|-----------------------------------|---------|--------------------|
| `asr.member.activated`            | ASR     | CON (trustlist)    |
| `asr.member.suspended`            | ASR     | CON (invalidate)   |
| `asr.connector.registered`        | ASR     | ORS (callback ACL) |
| `asr.keys.rotated`                | ASR     | CON, ORS           |
| `asr.trustlist.updated`           | ASR     | CON                |
| `ors.context.created`             | ORS     | subscribed parties |
| `ors.context.party-added/removed` | ORS     | CON (BVOD cache)   |
| `ors.context.event-occurred`      | ORS     | CON (webhooks)     |
| `con.webhook.delivered/failed/dead-lettered` | CON | observability |

## 6. Cryptography

See [SECURITY.md](SECURITY.md) for the full BDI JWS profile and key
management.

## 7. Testing

The full test suite runs without any external services. Every domain rule
has unit tests that exhaustively cover branches; every HTTP endpoint has
integration tests that drive the real router. `bun test --coverage` reports
100% line coverage for own source under `apps/*/src` and `packages/*/src`.

## 8. Extensibility

To replace an adapter:

1. Implement the matching port in `application/ports.ts`.
2. Register it in `composition-root.ts`.
3. No changes required in domain, application, or interface layers.

Examples already wired:

- `VerificationSource`: `KvkVerificationSource`, `ViesVerificationSource`,
  `KboVerificationSource`, `GleifVerificationSource`, all HTTP-backed.
- `SignerPort`: `JwsSigner` backed by HMAC; operators swap the underlying
  `RawSigner` (EdDSA / ES256 / PS256 / PKCS#11) without touching the use
  case.
- `HttpClientPort`: `FetchHttpClient` for production, `RecordingHttpClient`
  for tests.
