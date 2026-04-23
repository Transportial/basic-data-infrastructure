// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@bdi/kernel';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  type BvadClaims,
  type BvodClaims,
} from '@bdi/contracts';
import { EmbeddedPdp } from '@bdi/policy';
import { VerifyIncomingUseCase } from '../../src/application/use-cases/verify-incoming.ts';
import { ProxyForwardUseCase } from '../../src/application/use-cases/proxy-forward.ts';
import { RecordingHeaderedHttpClient } from '../../src/infrastructure/http-forward.ts';

const bvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:association:ctn',
  iat: 1000,
  exp: 1600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
  [BVAD_CLAIM_CONNECTOR]: {
    id: 'urn:bdi:connector:peer',
    x5t_s256: 'peer-thumb',
    bound_on: 0,
    authorised_by: 'rep',
  },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

const bvod: BvodClaims = {
  iss: 'https://ors',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:connector:me',
  iat: 1000,
  exp: 2000,
  jti: 'j-1',
  [BVOD_CLAIM_ASSOCIATION]: 'ctn',
  [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'shipment', identifiers: [] },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['carrier'] },
  [BVOD_CLAIM_SCOPE]: ['read:eta'],
};

function mkVerify(overrides?: { bvad?: BvadClaims | null; bvod?: BvodClaims | null }): VerifyIncomingUseCase {
  return new VerifyIncomingUseCase(
    { refresh: async () => {}, verifyBvad: async () => overrides?.bvad === undefined ? bvad : overrides.bvad },
    { verifyBvod: async () => overrides?.bvod === undefined ? bvod : overrides.bvod },
    new EmbeddedPdp([{ id: 'all', effect: 'permit', actions: '*' }]),
    new FakeClock(new Date(1_200_000)),
    {
      asrIssuer: 'https://asr',
      orsIssuer: 'https://ors',
      ownConnectorId: 'urn:bdi:connector:me',
      associationId: 'ctn',
      audience: 'urn:bdi:association:ctn',
    },
  );
}

describe('ProxyForwardUseCase', () => {
  test('verifies, resolves upstream, and forwards', async () => {
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://backend:3000' }],
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/shipments/42',
      headers: { 'content-type': 'application/json' },
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'read:shipment',
      resource: { type: 'shipment', id: '42' },
    });
    expect(r.ok).toBe(true);
    expect(http.calls[0]?.url).toBe('http://backend:3000/api/shipments/42');
    expect(http.calls[0]?.headers['authorization']).toBeUndefined();
    expect(http.calls[0]?.headers['x-bdi-verified-subject']).toBe('urn:bdi:connector:peer');
  });

  test('404 when no upstream matches', async () => {
    const uc = new ProxyForwardUseCase(mkVerify(), new RecordingHeaderedHttpClient(), {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/other/thing',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('no-matching-upstream');
  });

  test('picks the longest matching prefix', async () => {
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [
        { pathPrefix: '/api', target: 'http://short' },
        { pathPrefix: '/api/shipments', target: 'http://long' },
      ],
    });
    await uc.execute({
      method: 'GET',
      path: '/api/shipments/1',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(http.calls[0]?.url).toContain('http://long');
  });

  test('stripPrefix rewrites path', async () => {
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://backend', stripPrefix: true }],
    });
    await uc.execute({
      method: 'GET',
      path: '/api/shipments',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(http.calls[0]?.url).toBe('http://backend/shipments');
  });

  test('verify-failed propagates', async () => {
    const uc = new ProxyForwardUseCase(
      mkVerify({ bvad: null }),
      new RecordingHeaderedHttpClient(),
      { routes: [{ pathPrefix: '/api', target: 'http://b' }] },
    );
    const r = await uc.execute({
      method: 'GET',
      path: '/api/x',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('verify-failed');
  });

  test('mtls-mismatch when cert thumbprint differs', async () => {
    const uc = new ProxyForwardUseCase(mkVerify(), new RecordingHeaderedHttpClient(), {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/x',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
      clientCertThumbprint: 'wrong-thumb',
    });
    expect(!r.ok && r.error.type).toBe('mtls-mismatch');
  });

  test('mTLS succeeds when thumbprint matches', async () => {
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/x',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
      clientCertThumbprint: 'peer-thumb',
    });
    expect(r.ok).toBe(true);
  });

  test('upstream-failure on transport error', async () => {
    const http = new RecordingHeaderedHttpClient(() => {
      throw new Error('boom');
    });
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/x',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('upstream-failure');
  });

  test('upstream-failure on timeout', async () => {
    const http = new RecordingHeaderedHttpClient(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, headers: {}, body: '' }), 1000)),
    );
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
      timeoutMs: 5,
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/x',
      headers: {},
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(!r.ok && r.error.type).toBe('upstream-failure');
  });

  test('forwards allow-listed headers', async () => {
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://b' }],
      forwardHeaders: ['content-type', 'x-custom'],
    });
    await uc.execute({
      method: 'POST',
      path: '/api/x',
      headers: { 'content-type': 'application/json', 'x-custom': 'abc', authorization: 'Bearer x' },
      body: '{}',
      bvad: 'tok',
      bvod: 'tok',
      action: 'r',
      resource: { type: 't', id: '1' },
    });
    expect(http.calls[0]?.headers['x-custom']).toBe('abc');
    expect(http.calls[0]?.headers['authorization']).toBeUndefined();
  });
});
