# Contributing

Thanks for being here. This project is source-available under the
**PolyForm Shield License 1.0.0** (with `packages/contracts` additionally
under Apache 2.0), and contributions of every size — typo fixes, new
adapters, fresh ADRs, "this surprised me" issues — are genuinely welcome.

By submitting a contribution you agree your changes are licensed under
the same terms as the file(s) they touch.

The goal of the codebase is to be an *auditable*, production-grade
reference for the BDI protocol. Every choice in this guide flows from
that single goal: the code should be obvious enough that a stranger can
reason about its security properties without a tour.

## House rules

A short list. None of these are arbitrary; each one prevents a class of
bug we'd rather not have to fix.

- **Respect the layers.** `domain` must never import from
  `infrastructure`. Use cases depend on ports; adapters implement them.
  If the layering feels like it's getting in your way, please raise it
  in an issue — that's almost always a sign the *port* is shaped wrong.
- **No `any`, no `!`.** If the types aren't cooperating, adjust the types
  rather than escape them. Use `Result<T, E>` for expected failure modes.
- **Tests before merge.** We aim for 100% line coverage on our own
  source. Every branch of every use case needs a test. This isn't
  cargo-culting — it's how we keep the protocol from drifting under
  refactors.
- **Protocol shapes live in `@transportial/contracts`.** Don't re-declare token
  or envelope shapes inside a service. If a new claim is needed, add it
  there so all three services see it at once.
- **Errors are typed discriminated unions.** No `throw` in the domain
  layer; use `err({ type: 'reason' })`. Throwing makes flow control
  invisible and is the single biggest source of "wait, that could
  happen?" bugs.

## Branching

- `main` is always deployable; it's protected, requires green CI and
  review.
- Topic branches use the format `feat/<scope>-<desc>`,
  `fix/<scope>-<desc>`, `docs/<desc>`, `chore/<desc>`.
- Scopes match the package or app directory: `asr`, `ors`, `con`,
  `kernel`, `contracts`, `crypto`, `events`, `policy`, `observability`,
  `testing`, `config`, `infra`, `docs`.

## Commit messages

We use Conventional Commits — they're a small constraint that pays off
when you're scrolling through `git log` looking for the change that broke
something.

```
feat(asr): add GLEIF verification source

Implements the authoritative entity lookup required for assurance 'high'
when an LEI is provided. Falls back to partial outcome on non-200 from
the GLEIF data source.
```

## What we look for in review

A short checklist a reviewer (or you, before you ask for review) can run
through:

- [ ] Dependency direction respected
- [ ] No `any`, `as`, or non-null assertions without a short justification
- [ ] Tests cover both the success path and each `err` case of any new
      `Result`
- [ ] Any new event type has a schema in `@transportial/contracts` and is wired
      through an idempotent handler
- [ ] Environment variables registered in `@transportial/config`
- [ ] An ADR added for any non-trivial design decision
- [ ] Documentation updated where relevant (`README`, `ARCHITECTURE`,
      a runbook, or an ADR)

## Running locally

If you haven't already, [SETUP.md](SETUP.md) is the friendlier walk-through.
The short version:

```bash
bun install
bun test              # all tests
bun test --coverage   # coverage report
```

Per-package:

```bash
bun test --filter @transportial/asr
bun run --filter @transportial/asr dev   # watch-mode server
```

## Writing tests

A few patterns that have worked well for us — feel free to follow them or
deviate when something fits better:

- **Domain rules**: unit tests using fake clocks and deterministic ids.
- **Application use cases**: in-memory repositories + `FakeEventBus` +
  `FakeClock` + `DeterministicUuidGenerator`.
- **HTTP endpoints**: call `server.fetch(new Request(...))` directly —
  no network needed, and no test server to start and stop.
- **External adapters** (KvK / VIES / GLEIF / KBO): mock the `Fetcher`
  port, not `fetch` itself.
- **CON token verification**: build real JWS tokens with `@transportial/crypto`
  rather than hand-rolling base64.

## Releasing

1. Bump versions in each `package.json` so they match.
2. Tag `v<x>.<y>.<z>`; CI publishes OCI images to `ghcr.io`.
3. Update `CHANGELOG.md` per service.

## If you find a security issue

Please don't file a public issue. See [SECURITY.md](SECURITY.md) for the
private disclosure channel — we take security reports seriously and aim
to acknowledge within three business days.
