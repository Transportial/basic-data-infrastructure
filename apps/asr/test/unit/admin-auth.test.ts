// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { StaticBearerAuthn } from '@bdi/identity';
import { composeAsr } from '../../src/composition-root.ts';

describe('ASR admin auth middleware', () => {
  const principals = new Map([
    ['tok-admin', { subject: 'admin', roles: ['asr-admin'] }],
    ['tok-viewer', { subject: 'viewer', roles: ['viewer'] }],
  ]);
  const authn = new StaticBearerAuthn(principals);

  test('401 without Authorization header', async () => {
    const { router } = await composeAsr({
      issuer: 'https://asr.example',
      adminAuthn: authn,
      adminRequiredRoles: ['asr-admin'],
    });
    const res = await router.dispatch({
      method: 'POST',
      path: '/admin/members',
      headers: {},
      query: {},
      body: {},
      params: {},
    });
    expect(res.status).toBe(401);
  });

  test('401 with unknown bearer', async () => {
    const { router } = await composeAsr({
      issuer: 'https://asr.example',
      adminAuthn: authn,
      adminRequiredRoles: ['asr-admin'],
    });
    const res = await router.dispatch({
      method: 'POST',
      path: '/admin/members',
      headers: { authorization: 'Bearer nope' },
      query: {},
      body: {},
      params: {},
    });
    expect(res.status).toBe(401);
  });

  test('403 with known bearer but insufficient role', async () => {
    const { router } = await composeAsr({
      issuer: 'https://asr.example',
      adminAuthn: authn,
      adminRequiredRoles: ['asr-admin'],
    });
    const res = await router.dispatch({
      method: 'POST',
      path: '/admin/members',
      headers: { authorization: 'Bearer tok-viewer' },
      query: {},
      body: {},
      params: {},
    });
    expect(res.status).toBe(403);
  });

  test('allows through with admin role, and reaches handler (400 missing-body)', async () => {
    const { router } = await composeAsr({
      issuer: 'https://asr.example',
      adminAuthn: authn,
      adminRequiredRoles: ['asr-admin'],
    });
    const res = await router.dispatch({
      method: 'POST',
      path: '/admin/members',
      headers: { authorization: 'Bearer tok-admin' },
      query: {},
      body: null,
      params: {},
    });
    // Handler was reached — it should reply 400 for missing body (not 401/403).
    expect(res.status).toBe(400);
  });

  test('non-admin routes are unaffected by the middleware', async () => {
    const { router } = await composeAsr({
      issuer: 'https://asr.example',
      adminAuthn: authn,
      adminRequiredRoles: ['asr-admin'],
    });
    const res = await router.dispatch({
      method: 'GET',
      path: '/health/live',
      headers: {},
      query: {},
      body: null,
      params: {},
    });
    expect(res.status).toBe(200);
  });
});
