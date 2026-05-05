# BDI live-demo runbook

A copy-paste script for showing the three core services (ASR, ORS, CON) end
to end on a laptop. Every command below has been verified against the
current source tree. The whole thing fits in ~10 minutes.

> All commands run from the repo root:
> `/Users/thomaskolmans/Documents/Repositories/basic-data-infrastructure`

---

## 0. One-time setup

```bash
bun install
bun test     # safety net; should print "0 fail"
```

Open four terminal panes and label them **ASR**, **ORS**, **CON**, **shell**.

---

## 1. Boot the registers and the connector

### Pane ASR

```bash
DEMO_MODE=1 ASSOCIATION_ID=acme PORT=8080 \
  bun run --filter '@transportial/asr' start
```

`DEMO_MODE=1` wires in an always-success verification source so the live
flow doesn't depend on KvK / VIES being reachable. In production you swap
this for the real `KvkVerificationSource` etc.

### Pane ORS

```bash
ASSOCIATION_ID=acme PORT=8081 ORS_ISSUER=http://localhost:8081 \
  bun run --filter '@transportial/ors' start
```

### Pane CON

```bash
PORT=8443 \
ASR_ISSUER=http://localhost:8080 \
ORS_ISSUER=http://localhost:8081 \
ASSOCIATION_ID=acme \
CONNECTOR_ID=urn:bdi:connector:00000000-0000-4000-8000-000000000001 \
CON_AUDIENCE=urn:bdi:association:acme \
  bun run --filter '@transportial/con' start
```

### Pane shell — sanity check

```bash
curl -s http://localhost:8080/health/live   # {"status":"ok"}
curl -s http://localhost:8081/health/live   # {"status":"ok"}
curl -s http://localhost:8443/health/live   # {"status":"ok"}
```

Then show the ASR's published key material — the audience always finds
this satisfying:

```bash
curl -s http://localhost:8080/.well-known/jwks.json | python3 -m json.tool
```

---

## 2. Onboard a member

The member needs a *signing representative* before activation, so we go
direct to the HTTP API for this one call (the CLI `register-member` command
intentionally doesn't expose every onboarding field).

```bash
curl -s -X POST http://localhost:8080/admin/members \
  -H 'content-type: application/json' \
  -d '{
    "euid": "NL.NHR.87654321",
    "association_id": "acme",
    "legal_name": "Beta NV",
    "signing_representative": {
      "subject_id": "did:web:beta.example#sig1",
      "auth_source": "manual",
      "assurance": "high",
      "verified_at": "2026-05-05T10:00:00Z"
    }
  }'
```

Capture the returned `member_id` for the next steps:

```bash
export MID=<member_id-from-above>
```

---

## 3. Run authoritative-register verifications

```bash
bun run apps/cli/src/main.ts run-verifications \
  --asr http://localhost:8080 --member $MID
# {"status":"verifying"}
```

Narration: *"In production this fans out to KvK Basisprofiel v2, VIES,
GLEIF, KBO. Here we're using a deterministic stand-in so the demo is
network-free."*

---

## 4. Two-admin (4-eyes) approval

Two distinct approvers are required to activate a member. This is the
demo's "no single party can act unilaterally" beat.

```bash
bun run apps/cli/src/main.ts approve-member \
  --asr http://localhost:8080 --member $MID --approver alice
# {"state":"awaiting-second-approval"}

bun run apps/cli/src/main.ts approve-member \
  --asr http://localhost:8080 --member $MID --approver bob
# {"state":"activated"}
```

---

## 5. Show the signed trustlist

```bash
bun run apps/cli/src/main.ts trustlist-publish \
  --asr http://localhost:8080 --association-id acme
```

That's a compact JWS. Decode the payload live for effect:

```bash
bun run apps/cli/src/main.ts trustlist-publish \
  --asr http://localhost:8080 --association-id acme \
  | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip().split('.')[1]
p += '=' * (-len(p) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(p)), indent=2))"
```

Talking point: *"This is the document each connector caches and validates
offline. The registers stay out of the data plane — connectors enforce
locally."*

---

## 6. Register a connector for the member

Generate a connector key pair, then register it:

```bash
bun run apps/cli/src/main.ts generate-key \
  --out-public /tmp/conn.pub.jwk \
  --out-private /tmp/conn.priv.jwk
# {"kid":"<KID>","alg":"ES256"}

# Capture the kid printed above
export KID=<kid-from-above>

bun run apps/cli/src/main.ts register-connector \
  --asr http://localhost:8080 \
  --member $MID \
  --client-id urn:bdi:client:beta:1 \
  --jwk /tmp/conn.pub.jwk \
  --kid $KID \
  --cert-thumbprint 0000000000000000000000000000000000000000000000000000000000000000 \
  --cert-not-after 2000000000 \
  --callback http://localhost:9000/cb \
  --authorised-by alice
# {"connector_id":"urn:bdi:connector:..."}
```

(The cert thumbprint and `not_after` are placeholders for the demo. In
production these come from the connector's mTLS leaf cert via the ACME
flow under `/acme/`.)

---

## 7. Create a chain context (issue a BVOD)

The ORS owns the "for *this* exchange, *these* parties" decision.

```bash
bun run apps/cli/src/main.ts create-chain-context \
  --ors http://localhost:8081 \
  --association-id acme \
  --orchestrator NL.NHR.87654321 \
  --kind shipment
# {"chain_context_id":"<CTX>"}
```

Mention: *"The signed envelope (BVOD) issued from this context is what
authorises the exchange. The connector verifies it offline."*

---

## 8. Show the connector denying without a BVOD

Hit the connector with no chain-context envelope:

```bash
curl -i http://localhost:8443/some/protected/path
```

Expected: a `401`/`403` from the local PEP. *"The connector decided
locally — neither register was called."*

---

## 9. Wrap-up beats (no commands needed)

- Open `packages/recipe-otm` and `packages/recipe-fhir-r5` side by side —
  same `composeXRecipe(...)` shape, different domain.
- Open `apps/asr/src/infrastructure/verification-sources.ts` for 30
  seconds — point at `KvkVerificationSource`, `ViesVerificationSource`,
  `GleifVerificationSource`, `KboVerificationSource`. *"Pluggable
  interface — swap in a medical-board lookup or a financial-licence check
  the same way."*
- Mention the Compose stack (`infra/docker/compose.yaml`) as the path to
  Postgres + Valkey + Keycloak + Grafana when someone asks about
  production.

---

## Recovery cheat sheet

| Symptom | Fix |
|---|---|
| `bun run --filter ... start` exits in 90 ms | You are not in the repo root. `cd` back. |
| `EPERM` from `bun run --filter` | Same — Bun is scanning the wrong workspace root. |
| `jq: parse error` on `/health/live` | The endpoint returns JSON now — drop the pipe and retry. If still failing the service is down on that port. |
| `{"error":"no-verifications"}` | ASR was started without `DEMO_MODE=1`. Restart it. |
| `{"error":"not-verified"}` on approve | Member was registered without `signing_representative`. Re-register via the curl in §2. |
| `{"error":"member-not-found"}` | `$MID` got cleared between panes. Re-export it. |

## Cleanup

```bash
lsof -tiTCP:8080 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:8081 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:8443 -sTCP:LISTEN | xargs -r kill
rm -f /tmp/conn.pub.jwk /tmp/conn.priv.jwk
```
