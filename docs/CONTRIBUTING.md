# Contributing

Thanks for considering a contribution. This project aims for an auditable,
production-grade reference implementation. Please read the expectations
below before opening a PR.

## Ground rules

- **Respect the layers.** `domain` must never import from `infrastructure`.
  Use-cases depend on ports; adapters implement them.
- **No `any`, no `!`.** If the types aren't cooperating, adjust the types
  rather than escape them. Use `Result<T, E>` for expected failure modes.
- **Tests before merge.** We aim for 100% line coverage on our own source.
  Every branch of every use case must have a test.
- **Protocol shapes are in `@bdi/contracts`.** Don't re-declare token or
  envelope shapes in a service. If a new claim is needed, add it there.
- **Errors are typed discriminated unions.** No `throw` in the domain; use
  `err({ type: 'reason' })`.

## Branching

- `main` is always deployable; protected, requires green CI and review.
- Topic branches: `feat/<scope>-<desc>`, `fix/<scope>-<desc>`,
  `docs/<desc>`, `chore/<desc>`.
- Scopes match the package/app directory: `asr`, `ors`, `con`, `kernel`,
  `contracts`, `crypto`, `events`, `policy`, `observability`, `testing`,
  `config`, `infra`, `docs`.

## Commit messages

Conventional Commits, example:

```
feat(asr): add GLEIF verification source

Implements the authoritative entity lookup required for assurance 'high'
when an LEI is provided. Falls back to partial outcome on non-200 from
the GLEIF data source.
```

## Code review checklist

- [ ] Dependency direction respected
- [ ] No `any`, `as`, or non-null assertions without a short justification
- [ ] Added tests cover both success and each `err` case of new `Result`s
- [ ] Any new event type has a schema in `@bdi/contracts` and is wired
      through an idempotent handler
- [ ] Environment variables registered in `@bdi/config`
- [ ] ADR added for any non-trivial design decision
- [ ] Documentation updated (`README`, `ARCHITECTURE`, runbook or ADR)

## Running locally

```bash
bun install
bun test              # all tests
bun test --coverage   # coverage report
```

Per-package:

```bash
bun test --filter @bdi/asr
bun run --filter @bdi/asr dev   # watch-mode server
```

## Writing tests

- Domain rules: unit tests using fake clocks and deterministic ids.
- Application use cases: in-memory repositories + `FakeEventBus` +
  `FakeClock` + `DeterministicUuidGenerator`.
- HTTP endpoints: call `server.fetch(new Request(...))` directly — no
  network needed.
- External adapters (KvK/VIES/GLEIF/KBO): mock the `Fetcher` port.
- CON token verification: build real JWS tokens with `@bdi/crypto`.

## Releasing

1. Bump versions in each `package.json` to match.
2. Tag `v<x>.<y>.<z>`; CI publishes OCI images to `ghcr.io`.
3. Update `CHANGELOG.md` per service.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do **not** file public issues for
vulnerabilities — use the private disclosure channel documented there.
