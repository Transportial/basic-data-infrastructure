// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  buildOpenApi,
  commonSchemas,
  commonSecuritySchemes,
  toYaml,
} from '../src/index.ts';

describe('buildOpenApi', () => {
  test('translates template paths to OpenAPI braces', () => {
    const doc = buildOpenApi({
      title: 'T',
      version: '1',
      operations: [
        {
          method: 'GET',
          path: '/foo/:id',
          operationId: 'getFoo',
          summary: 'Get foo',
          responses: [{ status: 200, description: 'ok', schema: { type: 'object' } }],
        },
      ],
    });
    expect((doc.paths as Record<string, unknown>)['/foo/{id}']).toBeDefined();
  });

  test('merges multiple operations on one path', () => {
    const doc = buildOpenApi({
      title: 'T',
      version: '1',
      operations: [
        {
          method: 'GET',
          path: '/a',
          operationId: 'getA',
          summary: 'A',
          responses: [{ status: 200, description: 'ok' }],
        },
        {
          method: 'POST',
          path: '/a',
          operationId: 'postA',
          summary: 'A',
          responses: [{ status: 201, description: 'created' }],
        },
      ],
    });
    const path = (doc.paths as Record<string, Record<string, unknown>>)['/a']!;
    expect(Object.keys(path).sort()).toEqual(['get', 'post']);
  });

  test('requestBody with contentType and schema', () => {
    const doc = buildOpenApi({
      title: 'T',
      version: '1',
      operations: [
        {
          method: 'POST',
          path: '/x',
          operationId: 'x',
          summary: 'X',
          requestBody: {
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'body',
          },
          responses: [{ status: 200, description: 'ok' }],
        },
      ],
    });
    const body = (doc.paths as Record<string, Record<string, Record<string, Record<string, unknown>>>>)[
      '/x'
    ]!.post!.requestBody as Record<string, unknown>;
    expect(body.required).toBe(true);
    expect(body.description).toBe('body');
  });

  test('response with headers', () => {
    const doc = buildOpenApi({
      title: 'T',
      version: '1',
      operations: [
        {
          method: 'GET',
          path: '/x',
          operationId: 'x',
          summary: 'X',
          responses: [
            {
              status: 200,
              description: 'ok',
              headers: { 'x-foo': { description: 'f', schema: { type: 'string' } } },
            },
          ],
        },
      ],
    });
    const resp = (doc.paths as Record<string, Record<string, Record<string, Record<string, unknown>>>>)['/x']!.get!
      .responses as Record<string, { headers: unknown }>;
    expect(resp['200']?.headers).toBeDefined();
  });

  test('includes components, tags, servers, security', () => {
    const doc = buildOpenApi({
      title: 'T',
      version: '1',
      description: 'desc',
      servers: [{ url: 'https://asr', description: 'prod' }],
      tags: [{ name: 'onboarding', description: 'members' }],
      components: { schemas: commonSchemas, securitySchemes: commonSecuritySchemes },
      operations: [
        {
          method: 'GET',
          path: '/x',
          operationId: 'x',
          summary: 'X',
          security: [{ bearerAuth: [] }],
          responses: [{ status: 200, description: 'ok' }],
        },
      ],
    });
    expect(doc.servers).toBeDefined();
    expect(doc.tags).toBeDefined();
    expect(doc.components).toBeDefined();
  });

  test('common schemas and security present', () => {
    expect(commonSchemas.Euid.type).toBe('string');
    expect(commonSecuritySchemes.bearerAuth.scheme).toBe('bearer');
  });
});

describe('toYaml', () => {
  test('serialises object', () => {
    expect(toYaml({ a: 1, b: 'hello' })).toContain('a: 1');
  });

  test('serialises nested object', () => {
    const out = toYaml({ a: { b: 1 } });
    expect(out).toContain('a:\n');
    expect(out).toContain('b: 1');
  });

  test('serialises array', () => {
    const out = toYaml({ xs: [1, 2, 3] });
    expect(out).toContain('- 1');
  });

  test('quotes strings when needed', () => {
    expect(toYaml({ s: 'hello: world' })).toContain('"hello: world"');
  });

  test('handles empty containers', () => {
    expect(toYaml({ xs: [], ys: {} })).toContain('[]');
  });

  test('handles null', () => {
    expect(toYaml({ a: null })).toContain('null');
  });

  test('root-level arrays', () => {
    const out = toYaml([1, 2, 3]);
    expect(out).toContain('- 1');
  });

  test('nested arrays of objects', () => {
    const out = toYaml({ xs: [{ a: 1 }, { b: 2 }] });
    expect(out).toContain('a: 1');
    expect(out).toContain('b: 2');
  });

  test('scalar as top-level', () => {
    expect(toYaml('hello')).toBe('hello');
    expect(toYaml(42)).toBe('42');
    expect(toYaml(true)).toBe('true');
    expect(toYaml(null)).toBe('null');
  });
});
