// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { JwsSigner, randomSigningKey } from '../../src/infrastructure/crypto/signer.ts';
import { Router } from '../../src/interface/http/router.ts';
import { SystemUuidIds } from '../../src/infrastructure/id-port.ts';

describe('JwsSigner', () => {
  test('sign/verify round-trip', async () => {
    const s = new JwsSigner({ kid: 'k', key: randomSigningKey() });
    const tok = await s.signJwt({ a: 1 });
    const out = await s.verifyJwt(tok);
    expect((out as { a: number }).a).toBe(1);
  });

  test('verifyJwt rejects tampered', async () => {
    const s = new JwsSigner({ kid: 'k', key: randomSigningKey() });
    const tok = await s.signJwt({ a: 1 });
    const [h, p] = tok.split('.');
    await expect(s.verifyJwt(`${h}.${p}.AAAA`)).rejects.toThrow();
  });

  test('default alg ES256', async () => {
    const s = new JwsSigner({ kid: 'k', key: new Uint8Array(32) });
    const tok = await s.signJwt({});
    const header = JSON.parse(Buffer.from(tok.split('.')[0]!, 'base64url').toString('utf-8'));
    expect(header.alg).toBe('ES256');
  });

  test('trustlist() exposes size=1', () => {
    const s = new JwsSigner({ kid: 'k', key: new Uint8Array(32) });
    expect(s.trustlist().size()).toBe(1);
  });

  test('randomSigningKey produces 32-byte distinct keys', () => {
    const a = randomSigningKey();
    const b = randomSigningKey();
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('Router', () => {
  test('register and dispatch via helpers', async () => {
    const r = new Router();
    r.get('/a', async () => ({ status: 200 }));
    r.post('/b', async () => ({ status: 201 }));
    r.put('/c', async () => ({ status: 204 }));
    r.delete('/d', async () => ({ status: 204 }));
    expect((await r.dispatch({ method: 'GET', path: '/a', headers: {}, query: {}, body: null, params: {} })).status).toBe(200);
    expect((await r.dispatch({ method: 'POST', path: '/b', headers: {}, query: {}, body: null, params: {} })).status).toBe(201);
    expect((await r.dispatch({ method: 'PUT', path: '/c', headers: {}, query: {}, body: null, params: {} })).status).toBe(204);
    expect((await r.dispatch({ method: 'DELETE', path: '/d', headers: {}, query: {}, body: null, params: {} })).status).toBe(204);
  });

  test('trailing slash tolerated', async () => {
    const r = new Router();
    r.get('/x', async () => ({ status: 200 }));
    expect((await r.dispatch({ method: 'GET', path: '/x/', headers: {}, query: {}, body: null, params: {} })).status).toBe(200);
  });

  test('params extracted', async () => {
    const r = new Router();
    r.get('/x/:id', async (req) => ({ status: 200, body: req.params }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/x/abc',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.body).toEqual({ id: 'abc' });
  });

  test('unknown path → 404', async () => {
    const r = new Router();
    expect((await r.dispatch({ method: 'GET', path: '/nope', headers: {}, query: {}, body: null, params: {} })).status).toBe(404);
  });

  test('thrown Error → 500', async () => {
    const r = new Router();
    r.get('/x', async () => {
      throw new Error('boom');
    });
    const resp = await r.dispatch({ method: 'GET', path: '/x', headers: {}, query: {}, body: null, params: {} });
    expect(resp.status).toBe(500);
  });

  test('thrown non-Error → 500 unknown', async () => {
    const r = new Router();
    r.get('/x', async () => {
      throw 'str';
    });
    const resp = await r.dispatch({ method: 'GET', path: '/x', headers: {}, query: {}, body: null, params: {} });
    expect((resp.body as { message: string }).message).toBe('unknown');
  });

  test('match returns null for unknown', () => {
    const r = new Router();
    expect(r.match('GET', '/nope')).toBeNull();
  });
});

describe('SystemUuidIds', () => {
  test('produces UUIDs', () => {
    const g = new SystemUuidIds();
    expect(g.newUuid()).toMatch(/^[0-9a-f-]+$/);
  });
});
