// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MemoryCliIO, parseArgs } from '../src/commands.ts';
import {
  connectorShow,
  federationAdd,
  revokeCert,
  rotateKey,
  trustlistPublish,
} from '../src/impl.ts';

function makeIo(status = 200, responseBody: unknown = { ok: true }) {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const io = Object.assign(new MemoryCliIO(), {
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), ...(init !== undefined ? { init } : {}) });
      return new Response(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody), {
        status,
      });
    },
    seen,
  });
  return io;
}

describe('revokeCert', () => {
  test('happy path', async () => {
    const io = makeIo(200, { ok: true });
    const code = await revokeCert.execute(
      parseArgs(['--asr', 'https://asr', '--serial', 'abc123', '--reason', '4']),
      io,
    );
    expect(code).toBe(0);
    expect(io.seen[0]?.url).toBe('https://asr/acme/revoke-cert');
  });

  test('missing flags', async () => {
    const io = makeIo();
    expect(await revokeCert.execute(parseArgs([]), io)).toBe(2);
  });

  test('non-200 → 1', async () => {
    const io = makeIo(400);
    expect(
      await revokeCert.execute(
        parseArgs(['--asr', 'https://asr', '--serial', 'abc']),
        io,
      ),
    ).toBe(1);
  });
});

describe('rotateKey', () => {
  test('happy path', async () => {
    const io = makeIo(200, { newActiveKid: 'k1' });
    const code = await rotateKey.execute(parseArgs(['--asr', 'https://asr']), io);
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    expect(await rotateKey.execute(parseArgs([]), io)).toBe(2);
  });

  test('non-200', async () => {
    const io = makeIo(500);
    expect(await rotateKey.execute(parseArgs(['--asr', 'https://asr']), io)).toBe(1);
  });
});

describe('trustlistPublish', () => {
  test('prints body', async () => {
    const io = makeIo(200, 'jws-string');
    const code = await trustlistPublish.execute(
      parseArgs(['--asr', 'https://asr', '--association-id', 'ctn']),
      io,
    );
    expect(code).toBe(0);
    expect(io.stdoutLines[0]).toBe('jws-string');
  });

  test('missing flags', async () => {
    const io = makeIo();
    expect(await trustlistPublish.execute(parseArgs([]), io)).toBe(2);
  });

  test('404 returns 1', async () => {
    const io = makeIo(404, '');
    expect(
      await trustlistPublish.execute(
        parseArgs(['--asr', 'https://asr', '--association-id', 'ctn']),
        io,
      ),
    ).toBe(1);
  });
});

describe('federationAdd', () => {
  test('happy path reads jwk file', async () => {
    const io = makeIo(201, { ok: true });
    io.files.set('/tmp/peer.jwk', JSON.stringify({ kty: 'EC' }));
    const code = await federationAdd.execute(
      parseArgs([
        '--asr',
        'https://asr',
        '--peer-issuer',
        'https://peer',
        '--peer-association-id',
        'dtl',
        '--peer-kid',
        'k',
        '--peer-jwk',
        '/tmp/peer.jwk',
      ]),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    expect(await federationAdd.execute(parseArgs([]), io)).toBe(2);
  });

  test('allow=false is forwarded', async () => {
    const io = makeIo(201);
    io.files.set('/tmp/peer.jwk', JSON.stringify({ kty: 'EC' }));
    await federationAdd.execute(
      parseArgs([
        '--asr',
        'https://asr',
        '--peer-issuer',
        'https://peer',
        '--peer-association-id',
        'dtl',
        '--peer-kid',
        'k',
        '--peer-jwk',
        '/tmp/peer.jwk',
        '--allow',
        'false',
      ]),
      io,
    );
    const init = io.seen[0]?.init as { body?: string };
    expect(init?.body).toContain('"allow":false');
  });
});

describe('connectorShow', () => {
  test('by id', async () => {
    const io = makeIo(200, { id: 'urn:bdi:connector:x', status: 'active' });
    const code = await connectorShow.execute(
      parseArgs(['--asr', 'https://asr', '--id', 'urn:bdi:connector:x']),
      io,
    );
    expect(code).toBe(0);
    expect(io.seen[0]?.url).toContain('/admin/connectors/urn');
  });

  test('by client-id', async () => {
    const io = makeIo(200, {});
    const code = await connectorShow.execute(
      parseArgs(['--asr', 'https://asr', '--client-id', 'client-1']),
      io,
    );
    expect(code).toBe(0);
    expect(io.seen[0]?.url).toContain('client_id=client-1');
  });

  test('missing lookup key', async () => {
    const io = makeIo();
    expect(
      await connectorShow.execute(parseArgs(['--asr', 'https://asr']), io),
    ).toBe(2);
  });

  test('not found returns 1', async () => {
    const io = makeIo(404);
    expect(
      await connectorShow.execute(
        parseArgs(['--asr', 'https://asr', '--id', 'urn:bdi:connector:x']),
        io,
      ),
    ).toBe(1);
  });
});
