# ADR-0006: BDI JWS profile — algorithms, critical header, thumbprint

- Status: accepted
- Date: 2026-04-23

## Context

Interoperability between heterogeneous operators only works if the JWS
profile is *narrow* and *explicit*. RFC 7515 itself permits a wide
range of algorithms and header behaviours, and most of those choices
become attack surface the moment two operators disagree on them. At
the same time, we don't want to be so restrictive that we rule out
operators with reasonable production crypto stacks.

This ADR captures the line we drew.

## Decision

The profile is enforced by `@transportial/kernel/crypto-types/jws-header.ts` and
`@transportial/crypto/src/jws.ts`:

- `alg`: `EdDSA`, `ES256`, `ES384`, `PS256` only.
- `kid`: required.
- `x5t#S256`: required when a certificate is bound.
- `crit` must include `https://bdi.nl/v` with value `1`.
- Token-type-specific `typ` (`bvad+jwt`, `bvod+jwt`, `trustlist+jwt`).

The `crit` header is the important part: every verifier rejects any JWS
that doesn't carry a known profile version. That's what gives us a safe
upgrade path when we eventually need to roll out v2.

## Consequences

- Verification path is short and auditable — easy to reason about,
  easy to review.
- Adding a new algorithm (say, `ML-DSA` for post-quantum) is a one-line
  change in the allow-list, but bumps the profile version so verifiers
  who haven't updated will safely reject.
- Any JWT/JWS library we adopt must honour `crit` properly — a
  meaningful constraint when picking dependencies, but a worthwhile
  one.
