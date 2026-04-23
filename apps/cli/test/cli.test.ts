// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { MemoryCliIO, parseArgs } from '../src/commands.ts';
import {
  addConnectorId,
  approveMember,
  createChainContext,
  generateKey,
  registerConnector,
  registerMember,
  runVerifications,
} from '../src/impl.ts';

function makeIo(status = 201, responseBody: unknown = { member_id: 'm-1' }) {
  const io = Object.assign(new MemoryCliIO(), {
    fetch: async (_url: RequestInfo | URL, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(JSON.stringify(responseBody), { status });
    },
  });
  return io;
}

describe('parseArgs', () => {
  test('positional', () => {
    expect(parseArgs(['a', 'b'])).toEqual({ positional: ['a', 'b'], flags: {} });
  });
  test('--key value', () => {
    expect(parseArgs(['--foo', 'bar'])).toEqual({ positional: [], flags: { foo: 'bar' } });
  });
  test('--key=value', () => {
    expect(parseArgs(['--foo=bar'])).toEqual({ positional: [], flags: { foo: 'bar' } });
  });
  test('boolean flag', () => {
    expect(parseArgs(['--flag'])).toEqual({ positional: [], flags: { flag: true } });
  });
  test('mixed', () => {
    expect(parseArgs(['cmd', '--a', '1', '--b=2', 'pos', '--c'])).toEqual({
      positional: ['cmd', 'pos'],
      flags: { a: '1', b: '2', c: true },
    });
  });
});

describe('registerMember', () => {
  test('happy path calls POST /admin/members', async () => {
    const io = makeIo(201);
    const code = await registerMember.execute(
      parseArgs([
        '--asr',
        'https://asr.test',
        '--euid',
        'NL.NHR.12345678',
        '--association-id',
        'ctn',
        '--legal-name',
        'Acme BV',
        '--vat',
        'NL123',
        '--lei',
        'HWUPKR0MPOU8FGXBT394',
      ]),
      io,
    );
    expect(code).toBe(0);
    expect(io.stdoutLines[0]).toContain('member_id');
  });

  test('missing flags → usage + 2', async () => {
    const io = makeIo();
    const code = await registerMember.execute(parseArgs([]), io);
    expect(code).toBe(2);
    expect(io.stderrLines[0]).toContain('register-member');
  });

  test('bad euid → 2', async () => {
    const io = makeIo();
    const code = await registerMember.execute(
      parseArgs([
        '--asr',
        'https://asr.test',
        '--euid',
        'not-an-euid',
        '--association-id',
        'ctn',
        '--legal-name',
        'Acme',
      ]),
      io,
    );
    expect(code).toBe(2);
  });

  test('non-201 status → 1', async () => {
    const io = makeIo(409, { error: 'already-registered' });
    const code = await registerMember.execute(
      parseArgs([
        '--asr',
        'https://asr.test',
        '--euid',
        'NL.NHR.12345678',
        '--association-id',
        'ctn',
        '--legal-name',
        'Acme BV',
      ]),
      io,
    );
    expect(code).toBe(1);
  });
});

describe('approveMember', () => {
  test('happy path', async () => {
    const io = makeIo(200, { state: 'awaiting-second-approval' });
    const code = await approveMember.execute(
      parseArgs(['--asr', 'https://asr', '--member', 'm-1', '--approver', 'alice']),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    const code = await approveMember.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });
});

describe('runVerifications', () => {
  test('202 → 0', async () => {
    const io = makeIo(202, { status: 'verifying' });
    const code = await runVerifications.execute(
      parseArgs(['--asr', 'https://asr', '--member', 'm-1']),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    const code = await runVerifications.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });
});

describe('registerConnector', () => {
  test('happy path reads JWK from file', async () => {
    const io = makeIo(201, { connector_id: 'urn:bdi:connector:x' });
    io.files.set(
      '/tmp/pub.jwk',
      JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }),
    );
    const code = await registerConnector.execute(
      parseArgs([
        '--asr',
        'https://asr',
        '--member',
        'm-1',
        '--client-id',
        'client-1',
        '--jwk',
        '/tmp/pub.jwk',
        '--kid',
        'k',
        '--cert-thumbprint',
        'tp',
        '--cert-not-after',
        '1999999999',
        '--callback',
        'https://example.com/hook',
        '--authorised-by',
        'rep',
      ]),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    const code = await registerConnector.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });
});

describe('generateKey', () => {
  test('writes both JWKs', async () => {
    const io = makeIo();
    const code = await generateKey.execute(
      parseArgs(['--out-public', '/tmp/pub.jwk', '--out-private', '/tmp/priv.jwk']),
      io,
    );
    expect(code).toBe(0);
    expect(io.files.has('/tmp/pub.jwk')).toBe(true);
    expect(io.files.has('/tmp/priv.jwk')).toBe(true);
  });

  test('alg option honoured', async () => {
    const io = makeIo();
    const code = await generateKey.execute(
      parseArgs([
        '--out-public',
        '/tmp/pub.jwk',
        '--out-private',
        '/tmp/priv.jwk',
        '--alg',
        'EdDSA',
      ]),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    const code = await generateKey.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });
});

describe('createChainContext', () => {
  test('happy path', async () => {
    const io = makeIo(201, { chain_context_id: 'x' });
    const code = await createChainContext.execute(
      parseArgs([
        '--ors',
        'https://ors',
        '--association-id',
        'ctn',
        '--orchestrator',
        'NL.NHR.1',
        '--kind',
        'shipment',
      ]),
      io,
    );
    expect(code).toBe(0);
  });

  test('missing flags', async () => {
    const io = makeIo();
    const code = await createChainContext.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });
});

describe('make-connector-id', () => {
  test('happy path', async () => {
    const io = makeIo();
    const code = await addConnectorId.execute(
      parseArgs(['--uuid', '9f3a2c10-1234-4abc-89ab-cdef01234567']),
      io,
    );
    expect(code).toBe(0);
    expect(io.stdoutLines[0]).toContain('urn:bdi:connector:');
  });

  test('missing flag', async () => {
    const io = makeIo();
    const code = await addConnectorId.execute(parseArgs([]), io);
    expect(code).toBe(2);
  });

  test('bad uuid', async () => {
    const io = makeIo();
    const code = await addConnectorId.execute(parseArgs(['--uuid', 'not-uuid']), io);
    expect(code).toBe(2);
  });
});
