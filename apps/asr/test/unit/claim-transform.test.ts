// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  applyClaimRule,
  parseClaimRules,
  transformForPeer,
} from '../../src/application/claim-transform.ts';

describe('applyClaimRule', () => {
  test('defaults fill missing values', () => {
    const out = applyClaimRule({ a: 1 }, { defaults: { a: 99, b: 'x' } });
    expect(out).toEqual({ a: 1, b: 'x' });
  });

  test('drop removes listed claims', () => {
    const out = applyClaimRule({ a: 1, b: 2 }, { drop: ['b'] });
    expect(out).toEqual({ a: 1 });
  });

  test('rename renames a key', () => {
    const out = applyClaimRule({ a: 1, b: 2 }, { rename: { a: 'aa' } });
    expect(out).toEqual({ aa: 1, b: 2 });
  });

  test('map rewrites scalar values', () => {
    const out = applyClaimRule(
      { acr: 'LoA3' },
      { map: { acr: { LoA3: 'substantial', LoA4: 'high' } } },
    );
    expect(out).toEqual({ acr: 'substantial' });
  });

  test('add overrides earlier transforms', () => {
    const out = applyClaimRule(
      { a: 1 },
      { rename: { a: 'b' }, add: { b: 999 } },
    );
    expect(out).toEqual({ b: 999 });
  });
});

describe('transformForPeer', () => {
  const rules = parseClaimRules(`
default:
  drop:
    - email
  map:
    acr:
      LoA3: substantial
      LoA4: high
peers:
  - issuer: https://peer-a.example
    rename:
      sub: peer_sub
    add:
      peer_association_id: assoc-b
  - issuer: https://peer-b.example
    drop:
      - extra
`);

  test('falls back to default rule for unknown peer', () => {
    const out = transformForPeer(rules, 'https://unknown.example', {
      sub: 'alice',
      email: 'x@y',
      acr: 'LoA3',
    });
    expect(out).toEqual({ sub: 'alice', acr: 'substantial' });
  });

  test('combines default + peer-specific rules for peer-a', () => {
    const out = transformForPeer(rules, 'https://peer-a.example', {
      sub: 'alice',
      email: 'x@y',
      acr: 'LoA4',
    });
    expect(out).toEqual({
      peer_sub: 'alice',
      acr: 'high',
      peer_association_id: 'assoc-b',
    });
  });

  test('peer-b drops both the default email and its own extra claim', () => {
    const out = transformForPeer(rules, 'https://peer-b.example', {
      sub: 'bob',
      email: 'x@y',
      extra: 'ignore-me',
      acr: 'LoA3',
    });
    expect(out).toEqual({ sub: 'bob', acr: 'substantial' });
  });
});

describe('parseClaimRules', () => {
  test('empty sources produce empty rules', () => {
    expect(parseClaimRules('')).toEqual({ peers: [] });
  });

  test('rejects peers that lack an issuer', () => {
    expect(() => parseClaimRules(`peers:\n  - rename:\n      a: b\n`)).toThrow(
      'peer.issuer is required',
    );
  });

  test('rejects non-string rename value', () => {
    expect(() =>
      parseClaimRules(`
peers:
  - issuer: https://peer.example
    rename:
      a: 1
`),
    ).toThrow('rename values must be strings');
  });
});
