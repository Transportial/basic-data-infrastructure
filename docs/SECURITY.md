# Security and cryptography

This document covers how the BDI components sign things, verify things,
manage their keys, and what we worry about when we wear our security
hat. It's the place to start if you're auditing the implementation, or
if you're trying to figure out whether a particular threat is in scope.

If you've found something that needs to be fixed, jump to the bottom for
how to report it privately.

## The BDI JWS profile

Cryptographic interoperability between heterogeneous operators only
works if everyone agrees on a *narrow* set of choices. We've kept the
allowed surface deliberately small — every option is one less thing for
a verifier to get wrong.

Every compact JWS produced or consumed by these components must satisfy:

- **`alg`**: one of `EdDSA`, `ES256`, `ES384`, `PS256`. No HMAC variants
  for cross-trust signatures. No `none`. No `RS256`.
- **`kid`**: required, looked up against the trustlist.
- **`x5t#S256`**: required when the signer is certificate-backed
  (connectors). Must match a trustlist entry.
- **`crit`**: must include `https://bdi.nl/v` with value `1`. Verifiers
  reject any header that doesn't carry the profile version — that's how
  we'll roll out the next version safely.
- **`typ`**: recommended (`bvad+jwt`, `bvod+jwt`, `trustlist+jwt`).
- **Clock skew tolerance**: ±30 seconds by default, configurable per
  verifier.

Token lifetimes are intentionally short. The shorter the lifetime, the
smaller the window for any kind of replay or revocation race.

| Token type           | Max lifetime         |
|----------------------|----------------------|
| BVAD                 | 10 minutes           |
| BVOD                 | 60 minutes           |
| OAuth access token   | 15 minutes           |
| Member descriptor    | 24 hours             |
| Trustlist            | 5 minutes (CDN + invalidation) |
| Webhook detached sig | 5 minutes (replay)   |

All of these constants live in `@transportial/contracts`, so the wire profile is
single-source: one PR changes them everywhere or nowhere.

## Key management

Each service carries three sets of keys at any moment:

- **One active signing key** (kid `<svc>-<yyyy>-<nn>`).
- **One "next" key**, pre-published in the JWKS.
- **Retired keys** that stay in the JWKS for the lifetime of any tokens
  they signed, plus a buffer.

Rotation is a scheduled job (in the reference, a cron BullMQ job; in
development, called manually). When the active key rotates, the event
`asr.keys.rotated` is published so downstream consumers refresh their
trustlists immediately rather than waiting for the next poll.

### Signer adapters

The reference `JwsSigner` is backed by HMAC-SHA-256 via WebCrypto. It's a
real implementation of the `RawSigner` port — production deployments
just plug in a different one:

- An EdDSA adapter backed by WebCrypto (`Ed25519`) or `@noble/curves`.
- An ES256/ES384 adapter backed by WebCrypto (`ECDSA P-256/P-384`).
- A PS256 adapter backed by WebCrypto (`RSA-PSS` with MGF-1 SHA-256).
- A PKCS#11 / HSM adapter (step-ca's PKCS#11 integration, AWS KMS, GCP
  KMS, Azure Key Vault) — key material never leaves the HSM.

All adapters implement the same two methods, which is why swapping them
is a one-line composition-root change:

```ts
interface RawSigner {
  sign(payload: Uint8Array): Promise<Uint8Array>;
  verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean>;
}
```

## Certificate authority (ACME)

For production, `@transportial/crypto-ca` provides an RFC 8555 server skeleton with:

- External Account Binding (EAB) tied to the connector's `client_id`.
- `http-01` challenges by default; `dns-01` available opt-in.
- 90-day leaf certificate policy (`clientAuth` + `serverAuth` EKUs).
- CRL + OCSP distribution.
- Revocation via RFC 8555 `revoke-cert`.

Operators plug in the actual CA via the `CertificateAuthority` port:
a bundled step-ca adapter, a PKCS#11 / HSM adapter, or their own.

## Threat model — the short version

Here's what we worry about, and how the design responds to each one.

| Threat                          | Mitigation                                            |
|---------------------------------|-------------------------------------------------------|
| Stolen connector private key    | Cert revocation → trustlist update → BVAD fails next issuance; short BVAD lifetime bounds the window |
| Replayed BVAD                   | `jti` + 30s clock skew; BVAD-only, never used on the data plane |
| Replayed webhook                | `Bdi-Event-Id` seen-cache (7-day TTL) in CON         |
| Malicious subscription endpoint | Callback-URL whitelist via ASR registration           |
| Compromised ASR DB              | Tokens carry hashes, not PII; trustlist is signed     |
| Wrong-issuer impersonation      | BVAD `iss` pinned to the association root JWK in CON |

This list isn't exhaustive — it's the set of failure modes the dual-token
boundary was designed for. If you have a threat in mind that isn't
covered here, please raise an issue. We'd rather discuss it openly than
discover it the hard way.

## Reporting a security issue

If you discover a security issue, **please don't open a public GitHub
issue**. Email `security@connekt.nl` with:

- The affected component(s) and the commit SHA you're looking at.
- Reproduction steps, ideally as a minimal proof-of-concept.
- Any proposed mitigation, if you have one in mind.

We'll acknowledge within 3 business days and aim to disclose and fix
within 30 days. Responsible disclosure is much appreciated and we'll
credit you (or stay anonymous, your call) in the release notes.
