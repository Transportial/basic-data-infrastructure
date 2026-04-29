// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MemoryCliIO, parseArgs } from '../src/commands.ts';
import { initAssociation, validateInputs } from '../src/init-association.ts';

function ioWith(): MemoryCliIO {
  return new MemoryCliIO();
}

const goodFlags = [
  '--id', 'eu.nl.bdi.acme',
  '--name', 'Acme Logistics Association',
  '--domain', 'bdi.acme.example',
  '--admin-email', 'ops@acme.example',
  '--out', '/tmp/acme-deploy',
];

describe('validateInputs', () => {
  test('accepts a well-formed input', () => {
    expect(
      validateInputs({
        id: 'eu.nl.bdi.acme',
        name: 'Acme',
        domain: 'bdi.acme.example',
        adminEmail: 'ops@acme.example',
        outDir: '/tmp/acme',
        asrPort: 8080,
        orsPort: 8081,
        keycloakPort: 8180,
      }),
    ).toBeNull();
  });

  test('rejects an association id with uppercase or spaces', () => {
    expect(
      validateInputs({
        id: 'EU.Acme',
        name: 'x', domain: 'a.b', adminEmail: 'a@b.c',
        outDir: '/tmp/x', asrPort: 8080, orsPort: 8081, keycloakPort: 8180,
      }),
    ).toMatch(/bad --id/);
  });

  test('rejects an empty name', () => {
    expect(
      validateInputs({
        id: 'a.b', name: '   ', domain: 'a.b', adminEmail: 'a@b.c',
        outDir: '/tmp/x', asrPort: 8080, orsPort: 8081, keycloakPort: 8180,
      }),
    ).toMatch(/bad --name/);
  });

  test('rejects port collisions', () => {
    expect(
      validateInputs({
        id: 'a.b', name: 'x', domain: 'a.b', adminEmail: 'a@b.c',
        outDir: '/tmp/x', asrPort: 8080, orsPort: 8080, keycloakPort: 8180,
      }),
    ).toMatch(/distinct host port/);
  });

  test('rejects root as --out', () => {
    expect(
      validateInputs({
        id: 'a.b', name: 'x', domain: 'a.b', adminEmail: 'a@b.c',
        outDir: '/', asrPort: 8080, orsPort: 8081, keycloakPort: 8180,
      }),
    ).toMatch(/non-root/);
  });
});

describe('initAssociation command', () => {
  test('writes the full deployment tree', async () => {
    const io = ioWith();
    const code = await initAssociation.execute(parseArgs(goodFlags), io);
    expect(code).toBe(0);

    const expected = [
      '/tmp/acme-deploy/compose.yml',
      '/tmp/acme-deploy/.env.asr',
      '/tmp/acme-deploy/.env.ors',
      '/tmp/acme-deploy/keys/asr-signing-private.json',
      '/tmp/acme-deploy/keys/asr-signing-public.json',
      '/tmp/acme-deploy/keys/ors-signing-private.json',
      '/tmp/acme-deploy/keys/ors-signing-public.json',
      '/tmp/acme-deploy/db/init-multi-db.sh',
      '/tmp/acme-deploy/trustlist/seed.json',
      '/tmp/acme-deploy/admin/bootstrap.json',
      '/tmp/acme-deploy/README.md',
    ];
    for (const path of expected) {
      expect(io.files.has(path)).toBe(true);
    }
  });

  test('generates EdDSA keys with kid + use=sig and a matching public twin', async () => {
    const io = ioWith();
    await initAssociation.execute(parseArgs(goodFlags), io);

    const priv = JSON.parse(io.files.get('/tmp/acme-deploy/keys/asr-signing-private.json')!);
    const pub = JSON.parse(io.files.get('/tmp/acme-deploy/keys/asr-signing-public.json')!);

    expect(priv.kty).toBe('OKP');
    expect(priv.crv).toBe('Ed25519');
    expect(typeof priv.d).toBe('string');
    expect(priv.kid).toMatch(/^asr-/);
    expect(priv.use).toBe('sig');

    expect(pub.kid).toBe(priv.kid);
    expect(pub.x).toBe(priv.x);
    expect(pub.d).toBeUndefined();
  });

  test('asr and ors get distinct kids and distinct keys', async () => {
    const io = ioWith();
    await initAssociation.execute(parseArgs(goodFlags), io);

    const asrPriv = JSON.parse(io.files.get('/tmp/acme-deploy/keys/asr-signing-private.json')!);
    const orsPriv = JSON.parse(io.files.get('/tmp/acme-deploy/keys/ors-signing-private.json')!);

    expect(asrPriv.kid).not.toBe(orsPriv.kid);
    expect(asrPriv.x).not.toBe(orsPriv.x);
  });

  test('compose.yml references the chosen ports and embeds a generated db password', async () => {
    const io = ioWith();
    await initAssociation.execute(
      parseArgs([...goodFlags, '--asr-port', '9001', '--ors-port', '9002', '--keycloak-port', '9003']),
      io,
    );
    const compose = io.files.get('/tmp/acme-deploy/compose.yml')!;
    expect(compose).toMatch(/9001:8080/);
    expect(compose).toMatch(/9002:8080/);
    expect(compose).toMatch(/9003:8080/);
    expect(compose).toMatch(/POSTGRES_PASSWORD: [0-9a-f]{48}/);
    // The dev fallback "bdi:bdi" password from the repo's stock compose must
    // not leak into a generated one — every install gets fresh credentials.
    expect(compose).not.toMatch(/POSTGRES_PASSWORD: bdi\b/);
  });

  test('env files share the same db password as compose.yml', async () => {
    const io = ioWith();
    await initAssociation.execute(parseArgs(goodFlags), io);

    const compose = io.files.get('/tmp/acme-deploy/compose.yml')!;
    const asrEnv = io.files.get('/tmp/acme-deploy/.env.asr')!;
    const orsEnv = io.files.get('/tmp/acme-deploy/.env.ors')!;

    const composePw = compose.match(/POSTGRES_PASSWORD: ([0-9a-f]+)/)?.[1];
    expect(composePw).toBeDefined();
    expect(asrEnv).toContain(`postgres://bdi:${composePw}@postgres/asr_db`);
    expect(orsEnv).toContain(`postgres://bdi:${composePw}@postgres/ors_db`);
  });

  test('refuses to overwrite an existing deployment', async () => {
    const io = ioWith();
    io.files.set('/tmp/acme-deploy/compose.yml', '# pre-existing');
    const code = await initAssociation.execute(parseArgs(goodFlags), io);
    expect(code).toBe(1);
    expect(io.stderrLines.join('\n')).toMatch(/refusing to overwrite/);
    // The pre-existing file is left untouched.
    expect(io.files.get('/tmp/acme-deploy/compose.yml')).toBe('# pre-existing');
  });

  test('returns 2 with usage on a missing required flag', async () => {
    const io = ioWith();
    const code = await initAssociation.execute(parseArgs(goodFlags.filter((f) => f !== '--admin-email' && f !== 'ops@acme.example')), io);
    expect(code).toBe(2);
    expect(io.stderrLines.join('\n')).toMatch(/admin-email/);
  });

  test('bootstrap token is a 64-char hex string and printed to stdout', async () => {
    const io = ioWith();
    await initAssociation.execute(parseArgs(goodFlags), io);
    const bootstrap = JSON.parse(io.files.get('/tmp/acme-deploy/admin/bootstrap.json')!);
    expect(bootstrap.bootstrap_token).toMatch(/^[0-9a-f]{64}$/);
    expect(io.stdoutLines.join('\n')).toContain(bootstrap.bootstrap_token);
  });

  test('README points at the generated ports and signing kids', async () => {
    const io = ioWith();
    await initAssociation.execute(parseArgs(goodFlags), io);
    const readme = io.files.get('/tmp/acme-deploy/README.md')!;
    expect(readme).toContain('http://localhost:8080');
    expect(readme).toContain('http://localhost:8081');
    expect(readme).toContain('http://localhost:8180');
    const asrPriv = JSON.parse(io.files.get('/tmp/acme-deploy/keys/asr-signing-private.json')!);
    expect(readme).toContain(asrPriv.kid);
  });
});
