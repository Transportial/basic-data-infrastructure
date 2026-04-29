// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { loadEnv, parsers, formatEnvErrors } from '../src/env.ts';

describe('loadEnv', () => {
  test('loads all required fields', () => {
    const r = loadEnv(
      {
        PORT: { required: true, parse: parsers.integer({ min: 1, max: 65535 }) },
        HOST: { required: true, parse: parsers.string() },
      },
      { PORT: '8080', HOST: 'localhost' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.PORT).toBe(8080);
      expect(r.value.HOST).toBe('localhost');
    }
  });

  test('reports missing required', () => {
    const r = loadEnv({ PORT: { required: true, parse: parsers.integer() } }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.reason).toContain('missing');
  });

  test('uses default when missing', () => {
    const r = loadEnv(
      { LOG_LEVEL: { required: false, default: 'info', parse: parsers.string() } },
      {},
    );
    if (r.ok) expect(r.value.LOG_LEVEL).toBe('info');
  });

  test('uses default when empty', () => {
    const r = loadEnv(
      { LOG_LEVEL: { required: false, default: 'info', parse: parsers.string() } },
      { LOG_LEVEL: '' },
    );
    if (r.ok) expect(r.value.LOG_LEVEL).toBe('info');
  });

  test('returns undefined for optional without default', () => {
    const r = loadEnv({ X: { required: false, parse: parsers.string() } }, {});
    if (r.ok) expect(r.value.X).toBeUndefined();
  });

  test('reports parse failure', () => {
    const r = loadEnv({ PORT: { required: true, parse: parsers.integer() } }, { PORT: 'abc' });
    expect(!r.ok && r.error[0]?.reason).toContain('integer');
  });

  test('collects multiple errors', () => {
    const r = loadEnv(
      {
        A: { required: true, parse: parsers.string() },
        B: { required: true, parse: parsers.integer() },
      },
      { B: 'xyz' },
    );
    expect(!r.ok && r.error.length).toBe(2);
  });

  test('uses process.env by default', () => {
    process.env.BDI_TEST_DEFAULT_SOURCE = 'hello';
    const r = loadEnv({ BDI_TEST_DEFAULT_SOURCE: { required: true, parse: parsers.string() } });
    expect(r.ok).toBe(true);
    delete process.env.BDI_TEST_DEFAULT_SOURCE;
  });
});

describe('parsers', () => {
  test('string min/max length', () => {
    const r1 = parsers.string({ minLength: 3 })('ab');
    expect(!r1.ok && r1.error).toContain('shorter');
    const r2 = parsers.string({ maxLength: 2 })('abc');
    expect(!r2.ok && r2.error).toContain('longer');
    const r3 = parsers.string({ minLength: 2, maxLength: 10 })('hello');
    expect(r3.ok).toBe(true);
  });

  test('string pattern', () => {
    const p = parsers.string({ pattern: /^[a-z]+$/ });
    expect(p('abc').ok).toBe(true);
    expect(p('ABC').ok).toBe(false);
  });

  test('integer bounds', () => {
    const p = parsers.integer({ min: 0, max: 100 });
    const below = p('-1');
    expect(!below.ok && below.error).toContain('below');
    const above = p('101');
    expect(!above.ok && above.error).toContain('above');
    expect(p('50').ok).toBe(true);
  });

  test('integer bounds (no opts)', () => {
    const p = parsers.integer();
    expect(p('5').ok).toBe(true);
  });

  test('integer rejects non-numeric', () => {
    expect(parsers.integer()('abc').ok).toBe(false);
  });

  test('integer accepts negatives', () => {
    const r = parsers.integer()('-42');
    expect(r.ok && r.value).toBe(-42);
  });

  test('boolean accepts true variants', () => {
    const p = parsers.boolean();
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      const r = p(v);
      expect(r.ok && r.value).toBe(true);
    }
  });

  test('boolean accepts false variants', () => {
    const p = parsers.boolean();
    for (const v of ['0', 'false', 'no', 'off', 'FALSE']) {
      const r = p(v);
      expect(r.ok && r.value).toBe(false);
    }
  });

  test('boolean rejects unknown', () => {
    expect(parsers.boolean()('maybe').ok).toBe(false);
  });

  test('url accepts valid', () => {
    expect(parsers.url()('https://example.com').ok).toBe(true);
  });

  test('url rejects invalid', () => {
    expect(parsers.url()('not a url').ok).toBe(false);
  });

  test('enum accepts listed', () => {
    expect(parsers.enum(['a', 'b'] as const)('a').ok).toBe(true);
  });

  test('enum rejects unlisted', () => {
    const r = parsers.enum(['a', 'b'] as const)('c');
    expect(!r.ok && r.error).toContain('[a, b]');
  });

  test('csv parses list of integers', () => {
    const r = parsers.csv(parsers.integer())('1,2,3');
    expect(r.ok && r.value).toEqual([1, 2, 3]);
  });

  test('csv skips empty segments', () => {
    const r = parsers.csv(parsers.integer())('1, ,2');
    expect(r.ok && r.value).toEqual([1, 2]);
  });

  test('csv propagates inner error', () => {
    const r = parsers.csv(parsers.integer())('1,abc');
    expect(!r.ok && r.error).toContain('abc');
  });
});

describe('formatEnvErrors', () => {
  test('produces multi-line message', () => {
    const msg = formatEnvErrors([
      { field: 'X', reason: 'oops' },
      { field: 'Y', reason: 'boom' },
    ]);
    expect(msg).toContain('X: oops');
    expect(msg).toContain('Y: boom');
  });
});
