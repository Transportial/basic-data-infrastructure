// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
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
import { HmacSigner, InMemoryTrustlist, compactSign } from '@bdi/crypto';
import { createServer } from '../../src/server.ts';
import { RecordingHttpClient } from '../../src/infrastructure/http-client.ts';

function makeSignerList(kid: string) {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const signer = new HmacSigner(key);
  const list = new InMemoryTrustlist();
  list.add({ kid, signer });
  return { signer, list };
}

async function signBvad(signer: HmacSigner, kid: string, claims: BvadClaims) {
  return compactSign(claims, signer, { kid, alg: 'ES256', typ: 'bvad+jwt' });
}
async function signBvod(signer: HmacSigner, kid: string, claims: BvodClaims) {
  return compactSign(claims, signer, { kid, alg: 'ES256', typ: 'bvod+jwt' });
}

const ME = 'urn:bdi:connector:me';

const nowS = Math.floor(Date.now() / 1000);

function mkBvad(): BvadClaims {
  return {
    iss: 'https://asr',
    sub: 'urn:bdi:connector:peer',
    aud: 'urn:bdi:association:ctn',
    iat: nowS - 5,
    exp: nowS + 600,
    jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
    [BVAD_CLAIM_ASSOCIATION]: 'ctn',
    [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
    [BVAD_CLAIM_CONNECTOR]: {
      id: 'urn:bdi:connector:peer',
      x5t_s256: 'tp',
      bound_on: nowS - 3600,
      authorised_by: 'rep',
    },
    [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
    [BVAD_CLAIM_STATUS]: 'active',
  };
}

function mkBvod(): BvodClaims {
  return {
    iss: 'https://ors',
    sub: 'urn:bdi:connector:peer',
    aud: ME,
    iat: nowS - 5,
    exp: nowS + 600,
    jti: 'jti-1',
    [BVOD_CLAIM_ASSOCIATION]: 'ctn',
    [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'shipment', identifiers: [] },
    [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['carrier'] },
    [BVOD_CLAIM_SCOPE]: ['read:eta'],
  };
}

async function newServer(opts?: { httpStatus?: number }) {
  const asr = makeSignerList('asr-kid');
  const ors = makeSignerList('ors-kid');
  const http = new RecordingHttpClient(() => opts?.httpStatus ?? 200);
  const server = createServer({
    port: 0,
    asrIssuer: 'https://asr',
    orsIssuer: 'https://ors',
    associationId: 'ctn',
    ownConnectorId: ME,
    audience: 'urn:bdi:association:ctn',
    asrTrustlist: asr.list,
    orsTrustlist: ors.list,
    httpClient: http,
  });
  return { server, asr, ors, http };
}

describe('CON HTTP', () => {
  test('health endpoints', async () => {
    const { server } = await newServer();
    const live = await server.fetch(new Request('http://localhost/health/live'));
    expect(live.status).toBe(200);
    const ready = await server.fetch(new Request('http://localhost/health/ready'));
    expect(ready.status).toBe(200);
  });

  test('unknown route', async () => {
    const { server } = await newServer();
    expect((await server.fetch(new Request('http://localhost/nope'))).status).toBe(404);
  });

  test('invalid JSON', async () => {
    const { server } = await newServer();
    const res = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('proxy/check rejects without tokens', async () => {
    const { server } = await newServer();
    const res = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('proxy/check with valid tokens → 200', async () => {
    const { server, asr, ors } = await newServer();
    const bvad = await signBvad(asr.signer, 'asr-kid', mkBvad());
    const bvod = await signBvod(ors.signer, 'ors-kid', mkBvod());
    const res = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bvad}`,
          'x-bdi-context': bvod,
        },
        body: JSON.stringify({
          action: 'read:shipment',
          resource: { type: 'Shipment', id: 's-1' },
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test('proxy/check with valid tokens in body works too', async () => {
    const { server, asr, ors } = await newServer();
    const bvad = await signBvad(asr.signer, 'asr-kid', mkBvad());
    const bvod = await signBvod(ors.signer, 'ors-kid', mkBvod());
    const res = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bvad,
          bvod,
          action: 'read:shipment',
          resource: { type: 'Shipment', id: 's-1' },
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test('proxy/check with wrong-issuer BVAD → 401', async () => {
    const { server, asr, ors } = await newServer();
    const bvad = await signBvad(asr.signer, 'asr-kid', { ...mkBvad(), iss: 'other' });
    const bvod = await signBvod(ors.signer, 'ors-kid', mkBvod());
    const res = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bvad, bvod, action: 'r', resource: { type: 't', id: '1' } }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('webhook outbound creates delivery', async () => {
    const { server, http } = await newServer({ httpStatus: 200 });
    const res = await server.fetch(
      new Request('http://localhost/webhooks/outbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target_url: 'https://example.com/hook',
          event_id: 'e-1',
          event_type: 'ors.context.event-occurred',
          payload: { hello: 'world' },
        }),
      }),
    );
    expect(res.status).toBe(202);
    const body = JSON.parse(await res.text());
    expect(body.state).toBe('delivered');
    expect(http.calls).toHaveLength(1);
    const getRes = await server.fetch(
      new Request(`http://localhost/webhooks/deliveries/${body.delivery_id}`),
    );
    expect(getRes.status).toBe(200);
  });

  test('webhook outbound missing fields → 400', async () => {
    const { server } = await newServer();
    const res = await server.fetch(
      new Request('http://localhost/webhooks/outbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://x' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('webhook delivery unknown id → 404', async () => {
    const { server } = await newServer();
    const res = await server.fetch(
      new Request('http://localhost/webhooks/deliveries/unknown'),
    );
    expect(res.status).toBe(404);
  });

  test('webhook list endpoint', async () => {
    const { server } = await newServer({ httpStatus: 200 });
    await server.fetch(
      new Request('http://localhost/webhooks/outbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target_url: 'https://example.com/hook',
          event_id: 'e-1',
          event_type: 't',
          payload: {},
        }),
      }),
    );
    const res = await server.fetch(new Request('http://localhost/webhooks/deliveries'));
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(Array.isArray(body.pending)).toBe(true);
    expect(Array.isArray(body.dead)).toBe(true);
  });
});
