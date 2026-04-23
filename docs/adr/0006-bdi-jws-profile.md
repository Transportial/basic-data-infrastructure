# ADR-0006: BDI JWS profile — algorithms, critical header, thumbprint

- Status: accepted
- Date: 2026-04-23

## Context

Interoperability between heterogeneous operators requires a narrow,
explicit JWS profile. Allowing every RFC 7515 alg is a vulnerability
surface; allowing too few rules out operators.

## Decision

The profile, enforced by `@bdi/kernel/crypto-types/jws-header.ts` and
`@bdi/crypto/src/jws.ts`:

- `alg`: `EdDSA`, `ES256`, `ES384`, `PS256` only.
- `kid`: required.
- `x5t#S256`: required when a cert is bound.
- `crit` must include `https://bdi.nl/v` with value `1`.
- Token-type specific `typ` (`bvad+jwt`, `bvod+jwt`, `trustlist+jwt`).

## Consequences

- Verification path is short and auditable.
- Adding a new alg (e.g. `ML-DSA` for post-quantum) is a one-line
  change in the allow-list, but bumps the profile version.
- Any JWT/JWS library we adopt must honour `crit`.
