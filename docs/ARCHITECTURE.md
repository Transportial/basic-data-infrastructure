# Architecture

This is the deep-dive guide for engineers who want to understand how the
codebase is put together — how the three services talk to each other, why
the layering is enforced the way it is, and where to plug in your own
adapters when you take this to production.

If you're new to BDI as a concept, start with the [README](../README.md) for
the plain-language overview. If you want to *see* the system in motion,
the [interactive explorer](site/interactive/index.html) is a faster way in
than this document.

## 1. The big picture

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

A useful way to read this picture: the **registers (ASR, ORS) live above
the line; the connectors live below it**. The signed envelopes the
registers issue (BVAD, BVOD) flow downward; payload data flows
connector-to-connector and never touches a register. That separation is
what lets the system stay decentralised — and it's enforced in code, not
just on the diagram.

The reference implementation ships in-memory adapters for repositories,
event bus, and a signer backed by HMAC-SHA-256. Don't be fooled by the
word "in-memory": these are not stubs or mocks. They're complete
implementations of the same Port contracts a Drizzle/Postgres adapter or
an HSM-backed EdDSA signer satisfies — they just happen to keep state in
RAM and sign with a symmetric key, so the test suite is fully offline.
When you go to production, you swap them in `composition-root.ts`. You
don't touch a single line of domain or application code.

## 2. Clean architecture, in four layers

Every service in this repo follows the same shape:

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

The further "in" you go, the more durable the code becomes. The domain
layer is where the rules of BDI live — what makes a member valid, what a
chain context can and cannot contain, when a BVAD may be issued. Nothing
in there knows what HTTP, JSON, a database, or a JWS even is. That's what
makes domain rules cheap to test and safe to refactor.

The dependency rule is non-negotiable, and it's checked in CI:

| Layer           | May import from                                     |
|-----------------|-----------------------------------------------------|
| domain          | nothing (no Node built-ins that do I/O)             |
| application     | domain + shared packages (`@transportial/kernel`, etc.)      |
| infrastructure  | domain + application                                |
| interface       | application                                         |
| composition-root| everything (the only file allowed to cross layers)  |

Ports live in `application/ports.ts`; adapters implement those ports in
`infrastructure/`. Use cases never import from `infrastructure`. If you
catch yourself wanting to break that rule, that's usually a sign the port
itself is shaped wrong — fix the port, not the import.

## 3. The three services

### ASR — the membership office

The ASR's job is to admit members to an association and keep the
trustlist honest. Everything it does is some flavour of governance.

- **Aggregates**: `Member`, `Connector`, `FourEyesApproval`.
- **Use cases**: onboarding, verifications (KvK / KBO / GLEIF / VIES),
  4-eyes approval, connector registration, BVAD issuance, trustlist build.
- **External integrations** (pluggable via ports): KvK, KBO, GLEIF, VIES,
  Keycloak / eHerkenning, CA (ACME server interface defined in
  `@transportial/crypto-ca`, swappable between local, step-ca, and PKCS#11).

### ORS — the choreographer

The ORS owns *what's happening right now*. A shipment, a delegation, a
temporary right to act on someone's behalf — those are the things it
tracks, and it issues a BVOD that proves the relationship.

- **Aggregate**: `ChainContext` with parties, delegations, and natural-person
  pseudonyms.
- **Use cases**: context creation, party management, delegation, BVOD
  issuance, subscriptions, event publication.
- **Privacy invariant**: natural-person PII never leaves the member —
  the ORS stores only a deterministic pseudonym (see
  `src/domain/pseudonym.ts`). This is a hard rule, not a guideline.

### CON — the doorman at each member

The connector runs at the edge of every participating organisation. It's
the only piece of the system that sees actual payloads, and it makes
every allow/deny decision locally, against signed evidence.

- **Responsibilities**: validate BVAD + BVOD on inbound requests, evaluate
  local PEP/PDP, dispatch outbound webhooks with exponential backoff, DLQ.
- **Token verification pipeline** (see `application/use-cases/verify-incoming.ts`):
  1. BVAD signature (via trustlist)
  2. BVAD claim timing / issuer / audience / association / status
  3. BVOD signature (via ORS trust store)
  4. BVOD claim timing / audience / subject connector
  5. PDP decision

## 4. Shared packages

The shared packages aren't an afterthought; they're where the protocol
itself lives. Anything that has to look identical between two services
goes here, so it can never drift.

| Package             | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| `@transportial/kernel`       | Value objects (EUID, LEI, VAT, KvK, KBO, AssociationId, ConnectorId, ChainContextId), `Result`, `Clock`, BDI JWS header profile, JWK + thumbprint helpers. |
| `@transportial/contracts`    | Wire-format schemas (BVAD, BVOD, trustlist, OAuth, event envelope).     |
| `@transportial/crypto`       | BDI JWS sign/verify, HMAC signer, in-memory trustlist resolver.         |
| `@transportial/config`       | Fail-fast environment-variable parsing with typed errors.                |
| `@transportial/events`       | `EnvelopeProducer`, `InMemoryConsumer` with retry/DLQ classification.    |
| `@transportial/policy`       | `PolicyDecisionPoint` port + Cedar-inspired embedded PDP.                |
| `@transportial/observability`| Structured logger, Prometheus-compatible registry, trace context.       |
| `@transportial/testing`      | Fake event bus, fake signer, deterministic id generator.                 |

## 5. How the services talk to each other

The reference implementation ships an in-memory event bus per service; in
production you swap it for a Valkey Streams adapter (that's the entire
point of `EventBusPort` in `application/ports.ts`).

Everything that crosses a service boundary is wrapped in the same
envelope, so there's exactly one shape to learn:

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

Here's the catalogue of events you'll see in flight:

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

The crypto profile is deliberately narrow — it's a security feature, not
an oversight. See [SECURITY.md](SECURITY.md) for the full BDI JWS profile,
algorithms, header rules, and the key-management lifecycle.

## 7. Testing

The full test suite runs without any external services. Every domain rule
has unit tests that exhaustively cover branches; every HTTP endpoint has
integration tests that drive the real router. `bun test --coverage`
reports 100% line coverage for own source under `apps/*/src` and
`packages/*/src`.

That's not vanity coverage — it's how the layering stays honest. If a
new branch can sneak into a use case without a test, then the next
refactor can break it without a failing build, and the protocol drifts.

## 8. Extending the system

Replacing an adapter is a three-step recipe:

1. Implement the matching port in `application/ports.ts`.
2. Register it in `composition-root.ts`.
3. (There is no step three. No domain, application, or interface layer
   change is needed — that's the whole point.)

Adapters already wired up that you can use as templates:

- `VerificationSource`: `KvkVerificationSource`, `ViesVerificationSource`,
  `KboVerificationSource`, `GleifVerificationSource`, all HTTP-backed.
- `SignerPort`: `JwsSigner` backed by HMAC; production deployments swap
  the underlying `RawSigner` (EdDSA / ES256 / PS256 / PKCS#11) without
  touching the use case.
- `HttpClientPort`: `FetchHttpClient` for production, `RecordingHttpClient`
  for tests.

If you find yourself wanting to add an adapter and feeling like you have
to bend the port to make it fit, please open an issue. That's a signal
the port is wrong, not your adapter — and it's exactly the kind of
feedback we'd like to act on.
