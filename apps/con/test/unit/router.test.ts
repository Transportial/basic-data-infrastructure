// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { Router } from '../../src/interface/http/router.ts';

describe('CON Router', () => {
  test('dispatches GET/POST/PUT/DELETE', async () => {
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

  test('404 when no route', async () => {
    const r = new Router();
    expect((await r.dispatch({ method: 'GET', path: '/x', headers: {}, query: {}, body: null, params: {} })).status).toBe(404);
  });

  test('500 on thrown Error', async () => {
    const r = new Router();
    r.get('/x', async () => {
      throw new Error('boom');
    });
    expect((await r.dispatch({ method: 'GET', path: '/x', headers: {}, query: {}, body: null, params: {} })).status).toBe(500);
  });

  test('500 on thrown non-Error yields unknown', async () => {
    const r = new Router();
    r.get('/x', async () => {
      throw 42;
    });
    const resp = await r.dispatch({
      method: 'GET',
      path: '/x',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect((resp.body as { message: string }).message).toBe('unknown');
  });

  test('trailing slash tolerated', async () => {
    const r = new Router();
    r.get('/x', async () => ({ status: 200 }));
    expect((await r.dispatch({ method: 'GET', path: '/x/', headers: {}, query: {}, body: null, params: {} })).status).toBe(200);
  });

  test('match returns null on miss', () => {
    const r = new Router();
    expect(r.match('GET', '/x')).toBeNull();
  });

  test('params', async () => {
    const r = new Router();
    r.get('/x/:id', async (req) => ({ status: 200, body: req.params }));
    const resp = await r.dispatch({ method: 'GET', path: '/x/abc', headers: {}, query: {}, body: null, params: {} });
    expect(resp.body).toEqual({ id: 'abc' });
  });
});
