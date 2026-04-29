// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { generateKeyPair, publicJwk } from '@transportial/crypto';
import type { Command, CliIO, ParsedArgs } from './commands.ts';

// Bootstraps a fresh association deployment: ASR + ORS, fronted by Postgres,
// Valkey and Keycloak. Generates signing keys, env files, a docker-compose
// stack, and a README with the operator's exact next steps. Member-side
// connector installs are deliberately a separate flow.

export interface InitInputs {
  readonly id: string;            // association id, e.g. eu.nl.bdi.acme
  readonly name: string;          // human-readable association name
  readonly domain: string;        // public domain, e.g. bdi.acme.example
  readonly adminEmail: string;
  readonly outDir: string;
  readonly asrPort: number;
  readonly orsPort: number;
  readonly keycloakPort: number;
}

const ASSOC_ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function validateInputs(i: InitInputs): string | null {
  if (!ASSOC_ID_RE.test(i.id)) return `bad --id: must be lowercase dotted segments (got ${JSON.stringify(i.id)})`;
  if (i.name.trim().length === 0) return 'bad --name: must be non-empty';
  if (!DOMAIN_RE.test(i.domain)) return `bad --domain: must be a DNS hostname (got ${JSON.stringify(i.domain)})`;
  if (!EMAIL_RE.test(i.adminEmail)) return `bad --admin-email: must look like an email`;
  if (!i.outDir || i.outDir === '/') return 'bad --out: must be a non-root directory path';
  if (i.asrPort === i.orsPort || i.asrPort === i.keycloakPort || i.orsPort === i.keycloakPort) {
    return 'bad ports: ASR / ORS / Keycloak must each use a distinct host port';
  }
  return null;
}

export const initAssociation: Command = {
  name: 'init-association',
  description: 'Generate a fresh ASR+ORS deployment for a new association.',
  usage:
    'bdi init-association --id <association-id> --name "<name>" --domain <hostname>\n' +
    '                      --admin-email <email> --out <dir>\n' +
    '                      [--asr-port 8080] [--ors-port 8081] [--keycloak-port 8180]',
  async execute(args: ParsedArgs, io: CliIO): Promise<number> {
    const inputs: InitInputs = {
      id: stringFlag(args, 'id') ?? '',
      name: stringFlag(args, 'name') ?? '',
      domain: stringFlag(args, 'domain') ?? '',
      adminEmail: stringFlag(args, 'admin-email') ?? '',
      outDir: stringFlag(args, 'out') ?? '',
      asrPort: numberFlag(args, 'asr-port', 8080),
      orsPort: numberFlag(args, 'ors-port', 8081),
      keycloakPort: numberFlag(args, 'keycloak-port', 8180),
    };

    const err = validateInputs(inputs);
    if (err !== null) {
      io.stderr(err);
      io.stderr(this.usage);
      return 2;
    }

    const composePath = join(inputs.outDir, 'compose.yml');
    if (io.pathExists(composePath)) {
      io.stderr(`refusing to overwrite existing deployment at ${inputs.outDir} (compose.yml present)`);
      io.stderr('pick a different --out, or remove the existing directory yourself');
      return 1;
    }

    io.mkdirp(inputs.outDir);
    io.mkdirp(join(inputs.outDir, 'keys'));
    io.mkdirp(join(inputs.outDir, 'db'));
    io.mkdirp(join(inputs.outDir, 'trustlist'));
    io.mkdirp(join(inputs.outDir, 'admin'));

    const asrKid = `asr-${shortId(inputs.id)}-1`;
    const orsKid = `ors-${shortId(inputs.id)}-1`;
    const asrKeys = await generateKeyPair('EdDSA');
    const orsKeys = await generateKeyPair('EdDSA');
    const asrPriv = withKid(asrKeys.privateJwk, asrKid);
    const asrPub = withKid(publicJwk(asrKeys.publicJwk), asrKid);
    const orsPriv = withKid(orsKeys.privateJwk, orsKid);
    const orsPub = withKid(publicJwk(orsKeys.publicJwk), orsKid);

    const dbUserPw = randomToken(24);
    const adminBootstrapToken = randomToken(32);

    io.writeFileString(join(inputs.outDir, 'keys', 'asr-signing-private.json'), pretty(asrPriv));
    io.writeFileString(join(inputs.outDir, 'keys', 'asr-signing-public.json'), pretty(asrPub));
    io.writeFileString(join(inputs.outDir, 'keys', 'ors-signing-private.json'), pretty(orsPriv));
    io.writeFileString(join(inputs.outDir, 'keys', 'ors-signing-public.json'), pretty(orsPub));

    const issuerAsr = `https://asr.${inputs.domain}`;
    const issuerOrs = `https://ors.${inputs.domain}`;

    io.writeFileString(join(inputs.outDir, '.env.asr'), renderAsrEnv(inputs, asrKid, issuerAsr, dbUserPw));
    io.writeFileString(join(inputs.outDir, '.env.ors'), renderOrsEnv(inputs, orsKid, issuerOrs, issuerAsr, dbUserPw));
    io.writeFileString(composePath, renderCompose(inputs, dbUserPw));
    io.writeFileString(join(inputs.outDir, 'db', 'init-multi-db.sh'), renderInitDbScript());
    io.writeFileString(
      join(inputs.outDir, 'trustlist', 'seed.json'),
      pretty({ issuer: issuerAsr, association_id: inputs.id, members: [], signed_at: null, note: 'placeholder; ASR will publish a signed trustlist after first start.' }),
    );
    io.writeFileString(
      join(inputs.outDir, 'admin', 'bootstrap.json'),
      pretty({
        association_id: inputs.id,
        association_name: inputs.name,
        admin_email: inputs.adminEmail,
        bootstrap_token: adminBootstrapToken,
        notes: [
          'Use this token once to claim the admin account in Keycloak.',
          `Open http://localhost:${inputs.keycloakPort} (admin/admin), realm "bdi", and create a user with email ${inputs.adminEmail}.`,
          'Then rotate or destroy this file — the bootstrap token is single-use material.',
        ],
      }),
    );
    io.writeFileString(join(inputs.outDir, 'README.md'), renderReadme(inputs, asrKid, orsKid));

    io.stdout(`Wrote a fresh association deployment to ${inputs.outDir}`);
    io.stdout(`  ASR signing kid: ${asrKid}  →  http://localhost:${inputs.asrPort}`);
    io.stdout(`  ORS signing kid: ${orsKid}  →  http://localhost:${inputs.orsPort}`);
    io.stdout(`  Keycloak       : http://localhost:${inputs.keycloakPort}  (admin/admin)`);
    io.stdout(`  Bootstrap token: ${adminBootstrapToken}`);
    io.stdout('');
    io.stdout(`Next:  cd ${inputs.outDir} && docker compose up -d`);
    io.stdout(`Then:  see README.md for inviting your first member.`);

    return 0;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringFlag(args: ParsedArgs, name: string): string | null {
  const v = args.flags[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const v = args.flags[name];
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : fallback;
}

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function withKid(jwk: object, kid: string): Record<string, unknown> {
  return { ...(jwk as Record<string, unknown>), kid, use: 'sig' };
}

function shortId(associationId: string): string {
  return associationId.replace(/[^a-z0-9]/g, '').slice(0, 12) || 'assoc';
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Templates — kept inline so the CLI ships as a single bundle without
// resolving runtime template paths. Each renderer is a pure function from
// inputs to file content; tests assert on the strings directly.
// ---------------------------------------------------------------------------

function renderAsrEnv(i: InitInputs, kid: string, issuer: string, dbPw: string): string {
  return [
    `# ASR — ${i.name} (${i.id})`,
    `PORT=8080`,
    `ASR_ISSUER=${issuer}`,
    `ASR_ASSOCIATION_ID=${i.id}`,
    `ASR_SIGNING_KID=${kid}`,
    `ASR_SIGNING_KEY_PATH=/run/keys/asr-signing-private.json`,
    `DATABASE_URL=postgres://bdi:${dbPw}@postgres/asr_db`,
    `VALKEY_URL=redis://valkey:6379`,
    `KEYCLOAK_ISSUER=http://keycloak:8080/realms/bdi`,
    `LOG_LEVEL=info`,
    '',
  ].join('\n');
}

function renderOrsEnv(i: InitInputs, kid: string, issuer: string, asrIssuer: string, dbPw: string): string {
  return [
    `# ORS — ${i.name} (${i.id})`,
    `PORT=8080`,
    `ORS_ISSUER=${issuer}`,
    `ASR_ISSUER=${asrIssuer}`,
    `ORS_ASSOCIATION_ID=${i.id}`,
    `ORS_SIGNING_KID=${kid}`,
    `ORS_SIGNING_KEY_PATH=/run/keys/ors-signing-private.json`,
    `DATABASE_URL=postgres://bdi:${dbPw}@postgres/ors_db`,
    `VALKEY_URL=redis://valkey:6379`,
    `LOG_LEVEL=info`,
    '',
  ].join('\n');
}

function renderCompose(i: InitInputs, dbPw: string): string {
  return `name: bdi-${shortId(i.id)}
# Generated by \`bdi init-association\` for ${i.name} (${i.id}).
# Edit freely — re-running init-association refuses to overwrite this file.

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bdi
      POSTGRES_PASSWORD: ${dbPw}
      POSTGRES_MULTIPLE_DATABASES: asr_db,ors_db
    volumes:
      - ./db/init-multi-db.sh:/docker-entrypoint-initdb.d/10-multi-db.sh:ro
      - pgdata:/var/lib/postgresql/data
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bdi"]
      interval: 5s
      timeout: 3s
      retries: 10

  valkey:
    image: valkey/valkey:8-alpine
    command: valkey-server --save "" --appendonly yes
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HTTP_PORT: 8080
    ports: ["${i.keycloakPort}:8080"]

  asr:
    image: ghcr.io/transportial/bdi-asr:latest
    env_file: .env.asr
    volumes:
      - ./keys:/run/keys:ro
    ports: ["${i.asrPort}:8080"]
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:8080/health/ready"]
      interval: 5s

  ors:
    image: ghcr.io/transportial/bdi-ors:latest
    env_file: .env.ors
    volumes:
      - ./keys:/run/keys:ro
    ports: ["${i.orsPort}:8080"]
    depends_on:
      asr: { condition: service_healthy }

volumes:
  pgdata:
`;
}

function renderInitDbScript(): string {
  return `#!/bin/bash
# Creates one database per service, owned by POSTGRES_USER.
set -euo pipefail
for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
  echo "Creating database: $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE $db;
    GRANT ALL PRIVILEGES ON DATABASE $db TO $POSTGRES_USER;
EOSQL
done
`;
}

function renderReadme(i: InitInputs, asrKid: string, orsKid: string): string {
  return `# ${i.name} — BDI Association Deployment

\`${i.id}\`

This directory was generated by \`bdi init-association\`. It contains everything
needed to run an Associatie Register (ASR) and Orkestratie Register (ORS) for
your association, fronted by Postgres, Valkey, and Keycloak.

## Layout

\`\`\`
.
├── compose.yml              # Docker Compose stack (5 services)
├── .env.asr                 # ASR runtime configuration
├── .env.ors                 # ORS runtime configuration
├── keys/                    # Signing keys (private JWKs — see warning below)
│   ├── asr-signing-private.json
│   ├── asr-signing-public.json
│   ├── ors-signing-private.json
│   └── ors-signing-public.json
├── db/init-multi-db.sh      # Bootstrap: creates asr_db + ors_db on first start
├── trustlist/seed.json      # Empty placeholder; ASR publishes the real one
└── admin/bootstrap.json     # First-run admin invite material
\`\`\`

## Quick start

\`\`\`bash
docker compose up -d
docker compose ps           # all five services should report healthy
\`\`\`

When the stack is up:

| Service   | URL                                    |
|-----------|----------------------------------------|
| ASR       | http://localhost:${i.asrPort}                  |
| ORS       | http://localhost:${i.orsPort}                  |
| Keycloak  | http://localhost:${i.keycloakPort} (admin/admin)       |
| Postgres  | localhost:5432 (user \`bdi\`, see \`.env.asr\`) |
| Valkey    | localhost:6379                         |

Signing kids: \`${asrKid}\` (ASR), \`${orsKid}\` (ORS).

## First member

1. Authenticate as the admin user:
   - Open Keycloak, realm \`bdi\`, and create a user matching
     \`admin/bootstrap.json\` (\`${i.adminEmail}\`).
   - Hand them the \`bootstrap_token\` from \`admin/bootstrap.json\`. After their
     first login, delete \`admin/bootstrap.json\`.
2. Use the same \`bdi\` CLI that generated this directory to invite the first
   member organisation:
   \`\`\`bash
   bdi register-member \\
     --asr http://localhost:${i.asrPort} \\
     --association-id ${i.id} \\
     --euid eu.nl.kvk:12345678 \\
     --legal-name "Acme BV"
   \`\`\`
3. After the second 4-eyes approver runs \`bdi approve-member\`, the member is
   activated and can register their connector with \`bdi register-connector\`.

## Important: state persistence and key custody

This deployment uses the reference services' **in-memory repositories** for
the application state. Postgres is provisioned and reachable, but the current
\`bin.ts\` does not yet wire up the Postgres adapters automatically — state
will not survive a service restart. To go to production:

- Wire the Postgres adapters in your fork of \`apps/asr\` and \`apps/ors\` (see
  \`docs/SETUP.md\` and \`apps/asr/src/infrastructure/repositories/postgres.ts\`).
- Replace the file-on-disk signing keys in \`keys/\` with HSM- or PKCS#11-backed
  signers (see \`packages/crypto/src/hsm-signer.ts\`). The private JWKs in
  \`keys/\` are **acceptable for development only**.
- Point Keycloak at your real eHerkenning / eIDAS broker rather than the
  default \`start-dev\` realm.

## Regenerating

Re-running \`bdi init-association\` against this directory **refuses to
overwrite** any existing \`compose.yml\`. To rebuild from scratch, remove the
directory yourself and run the command again. To rotate signing keys without
disturbing the rest, use \`bdi rotate-key\` against the live ASR/ORS.

---

Generated by \`bdi init-association\` · PolyForm Shield 1.0.0
`;
}
