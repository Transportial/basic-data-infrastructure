# Getting set up locally

Welcome. This guide walks you from a clean machine to a running BDI stack
with a passing test suite — usually in under five minutes.

If anything here doesn't work the way it's described, that's a bug in this
guide; please open an issue or send a PR. We'd rather fix the docs than
have the next person struggle.

> **Just want to run a service?** The three components are published to npm.
> Skip the clone and run `npx -y @transportial/asr` (or `ors` / `con`). See
> the [README](../README.md#install-from-npm) for the full npm story; this
> guide covers the development workflow for hacking on the source.

## What you need

- **Bun** 1.2+ (we develop on 1.3; any 1.2+ will work). If you don't have
  it: `curl -fsSL https://bun.sh/install | bash`.
- **Node 22** is fine if you only want to run tooling without Bun, but
  the tests and dev commands assume Bun.
- **Docker** is optional — only needed if you want to run the reference
  Compose stack (Postgres, Valkey, Keycloak, Jaeger, Prometheus, Grafana,
  the admin portal).

There's nothing else. No global npm packages, no service to install, no
keys to generate.

## Clone and install

```bash
git clone <repo>
cd basic-data-infrastructure
bun install
```

Bun workspaces resolve `@transportial/*` packages by file path, so changes to a
shared package show up immediately — no link/build dance. TypeScript
paths are configured in `tsconfig.base.json`.

## Sanity check — does it work?

```bash
bun test                            # should print "0 fail"
bun test --coverage                 # prints a coverage table
bun run --filter '@transportial/asr' start   # boots ASR on :8080
```

Then in another shell:

```bash
curl -s http://localhost:8080/health/live | jq
```

If you see `0 fail` and a healthy `live` response, you have a working
BDI stack on your laptop. Congratulations.

## The default ports

| Service | Default port | Env var           |
|---------|--------------|-------------------|
| ASR     | 8080         | `PORT`            |
| ORS     | 8081         | `PORT`            |
| CON     | 8443         | `PORT`            |

## Environment variables

Every service validates its environment at boot time. If a required
variable is missing, you get a typed error and a non-zero exit — no
mysterious runtime behaviour ten minutes later. The parser lives in
`packages/config/src/env.ts`.

| Variable                | Services | Purpose                                          |
|-------------------------|----------|--------------------------------------------------|
| `PORT`                  | all      | HTTP listener port                               |
| `ASR_ISSUER`            | asr, ors, con | ASR's canonical URL                         |
| `ORS_ISSUER`            | ors, con | ORS's canonical URL                              |
| `ASSOCIATION_ID`        | con      | Association id this connector belongs to        |
| `CONNECTOR_ID`          | con      | URN of this connector                            |
| `CON_AUDIENCE`          | con      | Expected BVAD audience                           |
| `LOG_LEVEL`             | all      | `trace`\|`debug`\|`info`\|`warn`\|`error`        |

For KvK / VIES / GLEIF integrations, supply credentials via the
composition root (see `apps/asr/src/composition-root.ts`). The reference
`createServer` in `apps/asr/src/server.ts` accepts those fields in its
options.

## Running all three services together

In three separate terminals:

```bash
# terminal 1 — ASR
bun run --filter '@transportial/asr' start

# terminal 2 — ORS
ORS_ISSUER=http://localhost:8081 bun run --filter '@transportial/ors' start

# terminal 3 — CON
ASR_ISSUER=http://localhost:8080 \
ORS_ISSUER=http://localhost:8081 \
CONNECTOR_ID=urn:bdi:connector:00000000-0000-4000-8000-000000000001 \
  bun run --filter '@transportial/con' start
```

That gives you a complete BDI association running locally, with one
connector wired up. Add a second connector, point it at the same ASR/ORS,
and you've got an end-to-end exchange you can poke at.

## Or just use Docker

If you'd rather have everything (services + Postgres + Valkey + Keycloak
+ observability stack) come up together:

```bash
docker compose -f infra/docker/compose.yaml up --build
```

The Compose file builds each service from the shared `Dockerfile.bun`.

## Running tests

```bash
# Fast inner loop while you work on one package
bun test --filter @transportial/asr

# Everything, with a coverage report
bun test --coverage

# A single file
bun test apps/asr/test/integration/http-api.test.ts
```

The full suite is offline and self-contained, so you can run it on a
plane, in CI, or in a coffee shop where Wi-Fi has given up.

## Things that occasionally go wrong

- **Types don't resolve after `bun install`.** Run `bun install` from the
  repo root, not from inside an individual package.
- **"Port already in use".** Set `PORT=0` for an ephemeral port — useful
  in integration tests where you don't care about the exact number.
- **Trustlist verification fails in CON.** Make sure the
  `InMemoryTrustlist` in `asrTrustlist` has the same `kid` as the ASR
  signer you're using. This is the most common "huh, why doesn't this
  work" trip-up.

## What to read next

- [ARCHITECTURE.md](ARCHITECTURE.md) — the layered design, in depth
- [SECURITY.md](SECURITY.md) — crypto profile and key management
- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, commits, and review
  expectations if you'd like to send a patch
