// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { parseYaml } from '../src/yaml.ts';

describe('parseYaml', () => {
  test('empty input returns empty map', () => {
    expect(parseYaml('')).toEqual({});
  });

  test('scalars: strings, ints, booleans, null', () => {
    expect(
      parseYaml(`
name: alice
count: 42
active: true
missing: null
implicit:
`),
    ).toEqual({ name: 'alice', count: 42, active: true, missing: null, implicit: null });
  });

  test('quoted strings preserve inner spaces and colons', () => {
    expect(parseYaml(`name: "Alice: Admin"\npath: '/etc/hosts'`)).toEqual({
      name: 'Alice: Admin',
      path: '/etc/hosts',
    });
  });

  test('comments are stripped', () => {
    expect(
      parseYaml(`
# global comment
name: alice  # trailing comment
`),
    ).toEqual({ name: 'alice' });
  });

  test('nested map', () => {
    expect(
      parseYaml(`
peer:
  issuer: https://peer.example
  kid: abc123
  nested:
    deep:
      x: 1
`),
    ).toEqual({
      peer: {
        issuer: 'https://peer.example',
        kid: 'abc123',
        nested: { deep: { x: 1 } },
      },
    });
  });

  test('sequence of strings', () => {
    expect(
      parseYaml(`
roles:
  - admin
  - operator
  - viewer
`),
    ).toEqual({ roles: ['admin', 'operator', 'viewer'] });
  });

  test('sequence of maps (inline "- key: value" shorthand)', () => {
    expect(
      parseYaml(`
peers:
  - issuer: https://a.example
    allow: true
  - issuer: https://b.example
    allow: false
`),
    ).toEqual({
      peers: [
        { issuer: 'https://a.example', allow: true },
        { issuer: 'https://b.example', allow: false },
      ],
    });
  });

  test('deeply nested maps inside a sequence item', () => {
    const result = parseYaml(`
peers:
  - issuer: https://peer.example
    rename:
      roles: peer_roles
    add:
      peer_association_id: assoc-b
`);
    expect(result).toEqual({
      peers: [
        {
          issuer: 'https://peer.example',
          rename: { roles: 'peer_roles' },
          add: { peer_association_id: 'assoc-b' },
        },
      ],
    });
  });

  test('throws on missing colon', () => {
    expect(() => parseYaml('foo\nbar: 1')).toThrow('expected');
  });
});
