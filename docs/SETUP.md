# Local setup

This guide walks you from a clean machine to a running BDI stack with tests.

## Prerequisites

- **Bun** 1.2+ (we develop on 1.3; any 1.2+ will work)
- **Node 22** is sufficient if you want to run the tooling without Bun,
  but tests and dev commands assume Bun.
- **Docker** (optional) if you want to run the reference Compose stack.

## Clone & install

```bash
git clone <repo>
cd basic-data-infrastructure
bun install
```

Bun workspaces resolve `@bdi/*` packages by file path. TypeScript paths
are configured in `tsconfig.base.json`.

## Sanity check

```bash
bun test                            # should print "0 fail"
bun test --coverage                 # prints a coverage table
bun run --filter '@bdi/asr' start   # boots ASR on :8080
```

Then in another shell:

```bash
curl -s http://localhost:8080/health/live | jq
```

## Per-service ports

| Service | Default port | Env var           |
|---------|--------------|-------------------|
| ASR     | 8080         | `PORT`            |
| ORS     | 8081         | `PORT`            |
| CON     | 8443         | `PORT`            |

## Environment variables

Every service validates its env at boot. Missing required vars fail fast
with a typed error (see `packages/config/src/env.ts`).

| Variable                | Services | Purpose                                          |
|-------------------------|----------|--------------------------------------------------|
| `PORT`                  | all      | HTTP listener port                               |
| `ASR_ISSUER`            | asr, ors, con | ASR's canonical URL                         |
| `ORS_ISSUER`            | ors, con | ORS's canonical URL                              |
| `ASSOCIATION_ID`        | con      | Association id this connector belongs to        |
| `CONNECTOR_ID`          | con      | URN of this connector                            |
| `CON_AUDIENCE`          | con      | Expected BVAD audience                           |
| `LOG_LEVEL`             | all      | `trace`\|`debug`\|`info`\|`warn`\|`error`        |

For KvK/VIES/GLEIF integrations you supply them via the composition root
(see `apps/asr/src/composition-root.ts`). The reference `createServer` in
`apps/asr/src/server.ts` accepts those fields in its options.

## Running three services together

```bash
# terminal 1
bun run --filter '@bdi/asr' start

# terminal 2
ORS_ISSUER=http://localhost:8081 bun run --filter '@bdi/ors' start

# terminal 3
ASR_ISSUER=http://localhost:8080 \
ORS_ISSUER=http://localhost:8081 \
CONNECTOR_ID=urn:bdi:connector:00000000-0000-4000-8000-000000000001 \
  bun run --filter '@bdi/con' start
```

## Docker

```bash
docker compose -f infra/docker/compose.yaml up --build
```

The Compose file builds each service from the shared `Dockerfile.bun`.

## Testing matrix

```bash
# Fast inner loop
bun test --filter @bdi/asr

# With coverage
bun test --coverage

# A single file
bun test apps/asr/test/integration/http-api.test.ts
```

## Common troubleshooting

- **Types don't resolve after `bun install`** — run `bun install` from the
  repo root, not inside a package.
- **Port already in use** — pass `PORT=0` for an ephemeral port during
  integration tests.
- **Trustlist verification fails in CON** — ensure the `InMemoryTrustlist`
  in `asrTrustlist` has the same `kid` as the ASR signer you're using.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — layered design
- [SECURITY.md](SECURITY.md) — crypto profile & key management
- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, commits, reviews
