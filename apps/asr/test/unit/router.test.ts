// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { Router } from '../../src/interface/http/router.ts';

describe('Router', () => {
  test('matches static GET', async () => {
    const r = new Router();
    r.get('/health', async () => ({ status: 200, body: { ok: true } }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/health',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.status).toBe(200);
  });

  test('matches parameterised routes', async () => {
    const r = new Router();
    r.get('/members/:id', async (req) => ({ status: 200, body: { id: req.params.id } }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/members/abc',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.body).toEqual({ id: 'abc' });
  });

  test('returns 404 when no match', async () => {
    const r = new Router();
    r.get('/x', async () => ({ status: 200 }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/y',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.status).toBe(404);
  });

  test('method mismatch → 404', async () => {
    const r = new Router();
    r.get('/x', async () => ({ status: 200 }));
    const resp = await r.dispatch({
      method: 'POST',
      path: '/x',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.status).toBe(404);
  });

  test('catches thrown errors as 500', async () => {
    const r = new Router();
    r.get('/boom', async () => {
      throw new Error('oops');
    });
    const resp = await r.dispatch({
      method: 'GET',
      path: '/boom',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.status).toBe(500);
    expect((resp.body as { message: string }).message).toBe('oops');
  });

  test('catches non-Error throws', async () => {
    const r = new Router();
    r.get('/boom', async () => {
      throw 'string error';
    });
    const resp = await r.dispatch({
      method: 'GET',
      path: '/boom',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect((resp.body as { message: string }).message).toBe('unknown');
  });

  test('strips trailing slash', async () => {
    const r = new Router();
    r.get('/x', async () => ({ status: 200, body: 'match' }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/x/',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.body).toBe('match');
  });

  test('POST/PUT/DELETE register helpers', async () => {
    const r = new Router();
    r.post('/p', async () => ({ status: 201 }));
    r.put('/p', async () => ({ status: 200 }));
    r.delete('/p', async () => ({ status: 204 }));
    const post = await r.dispatch({
      method: 'POST',
      path: '/p',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    const put = await r.dispatch({
      method: 'PUT',
      path: '/p',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    const del = await r.dispatch({
      method: 'DELETE',
      path: '/p',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect([post.status, put.status, del.status]).toEqual([201, 200, 204]);
  });

  test('match returns null for unknown', () => {
    const r = new Router();
    expect(r.match('GET', '/nope')).toBeNull();
  });

  test('multiple params', async () => {
    const r = new Router();
    r.get('/a/:x/b/:y', async (req) => ({ status: 200, body: req.params }));
    const resp = await r.dispatch({
      method: 'GET',
      path: '/a/1/b/2',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(resp.body).toEqual({ x: '1', y: '2' });
  });
});
