# Security & Cryptography

## BDI JWS profile

Every compact JWS produced or consumed by these components must satisfy:

- **`alg`**: one of `EdDSA`, `ES256`, `ES384`, `PS256`. No RSA-signed HS
  variants; no `none`; no RS256.
- **`kid`**: required. Lookup against the trustlist.
- **`x5t#S256`**: required when the signer is certificate-backed
  (connectors). Must match a trustlist entry.
- **`crit`**: must include `https://bdi.nl/v` with value `1`. Verifiers
  reject any header that doesn't carry the profile version.
- **`typ`**: recommended (`bvad+jwt`, `bvod+jwt`, `trustlist+jwt`).
- **Clock skew tolerance**: ±30 seconds by default (configurable per
  verifier).

| Token type           | Max lifetime         |
|----------------------|----------------------|
| BVAD                 | 10 minutes           |
| BVOD                 | 60 minutes           |
| OAuth access token   | 15 minutes           |
| Member descriptor    | 24 hours             |
| Trustlist            | 5 minutes (CDN + invalidation) |
| Webhook detached sig | 5 minutes (replay)   |

All constants live in `@bdi/contracts` so the wire profile is single-source.

## Key management

Each service carries:

- **One active signing key** (kid `<svc>-<yyyy>-<nn>`)
- **One "next" key** pre-published in the JWKS
- **Retired keys** that remain in the JWKS for their issued-token lifetime
  plus a buffer

Rotation is a scheduled job (in the reference, a cron BullMQ job; in
development, called manually). When the active key rotates, the event
`asr.keys.rotated` is published so consumers refresh their trustlists.

### Signer adapters

The reference `JwsSigner` is backed by HMAC-SHA-256 via WebCrypto. It
conforms to the `RawSigner` port so production deployments plug in:

- An EdDSA adapter backed by WebCrypto (`Ed25519`) or `@noble/curves`.
- An ES256/ES384 adapter backed by WebCrypto (`ECDSA P-256/P-384`).
- A PS256 adapter backed by WebCrypto (`RSA-PSS` with MGF-1 SHA-256).
- A PKCS#11 / HSM adapter (step-ca's PKCS#11 integration, AWS KMS, GCP
  KMS, Azure Key Vault) — key material never leaves the HSM.

All adapters implement the same two methods:

```ts
interface RawSigner {
  sign(payload: Uint8Array): Promise<Uint8Array>;
  verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean>;
}
```

## Certificate authority (ACME)

For the production implementation `@bdi/crypto-ca` provides an RFC 8555
server skeleton with:

- External Account Binding (EAB) tied to the connector's client_id
- `http-01` and (opt-in) `dns-01` challenges
- 90-day leaf certificate policy (`clientAuth` + `serverAuth` EKUs)
- CRL + OCSP distribution
- Revocation via RFC 8555 `revoke-cert`

Operators plug in the actual CA via `CertificateAuthority` port:
a bundled step-ca adapter, a PKCS#11/HSM adapter, or their own.

## Threat model (summary)

| Threat                          | Mitigation                                            |
|---------------------------------|-------------------------------------------------------|
| Stolen connector private key    | Cert revocation → trustlist update → BVAD fails next issuance; short BVAD lifetime bounds window |
| Replayed BVAD                   | `jti` + 30s clock skew; BVAD-only, not for data-plane |
| Replayed webhook                | `Bdi-Event-Id` seen-cache (7-day TTL) in CON         |
| Malicious subscription endpoint | Callback-URL whitelist via ASR registration           |
| Compromised ASR DB              | Tokens carry hashes, not PII; trustlist is signed     |
| Wrong issuer impersonation      | BVAD `iss` pinned to association root JWK in CON     |

## Reporting

If you discover a security issue, **do not** file a public issue. Email
`security@connekt.nl` with:

- Affected component(s) and commit SHA
- Reproduction steps
- Proposed mitigation, if any

We'll acknowledge within 3 business days and aim to disclose & fix within
30 days.
