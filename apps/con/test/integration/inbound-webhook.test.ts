// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { compactSign, HmacSigner, InMemoryTrustlist } from '@transportial/crypto';
import { createServer } from '../../src/server.ts';

async function sha256B64(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let s = '';
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('CON inbound webhook', () => {
  test('accepts a signed webhook from allowed issuer', async () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const signer = new HmacSigner(key);
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k-1', signer });
    const server = createServer({
      port: 0,
      asrIssuer: 'https://asr.test',
      orsIssuer: 'https://ors.test',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
      asrTrustlist: list,
      allowedIssuers: ['https://asr.test'],
    });
    const body = JSON.stringify({ hi: 1 });
    const bodyHash = await sha256B64(new TextEncoder().encode(body));
    const jws = await compactSign(
      { body_sha256: bodyHash, iss: 'https://asr.test' },
      signer,
      { kid: 'k-1', alg: 'ES256' },
    );
    const res = await server.fetch(
      new Request('http://localhost/webhooks/inbound', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'bdi-signature': jws,
          'bdi-event-id': 'e-1',
          'bdi-event-type': 'ors.context.event-occurred',
          'bdi-issuer': 'https://asr.test',
        },
        body,
      }),
    );
    expect(res.status).toBe(202);
  });

  test('rejects unknown issuer', async () => {
    const server = createServer({
      port: 0,
      asrIssuer: 'https://asr.test',
      orsIssuer: 'https://ors.test',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
      allowedIssuers: ['https://asr.test'],
    });
    const res = await server.fetch(
      new Request('http://localhost/webhooks/inbound', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'bdi-signature': 'a.b.c',
          'bdi-event-id': 'e-1',
          'bdi-event-type': 't',
          'bdi-issuer': 'https://evil',
        },
        body: '{}',
      }),
    );
    expect(res.status).toBe(403);
  });

  test('rejects missing headers', async () => {
    const server = createServer({
      port: 0,
      asrIssuer: 'https://asr.test',
      orsIssuer: 'https://ors.test',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
    });
    const res = await server.fetch(
      new Request('http://localhost/webhooks/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('rate-limit kicks in at limit', async () => {
    const server = createServer({
      port: 0,
      asrIssuer: 'https://asr.test',
      orsIssuer: 'https://ors.test',
      associationId: 'ctn',
      ownConnectorId: 'urn:bdi:connector:me',
      audience: 'aud',
      rateLimit: { limit: 2, windowMs: 60_000 },
    });
    for (let i = 0; i < 2; i++) {
      const r = await server.fetch(
        new Request('http://localhost/proxy/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-client-id': 'fred' },
          body: JSON.stringify({ action: 'r', resource: { type: 't', id: '1' } }),
        }),
      );
      // Returns 401 (no bvad) but shows rate-limit hasn't kicked in.
      expect(r.status).toBeLessThan(500);
    }
    const overflow = await server.fetch(
      new Request('http://localhost/proxy/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': 'fred' },
        body: JSON.stringify({ action: 'r', resource: { type: 't', id: '1' } }),
      }),
    );
    expect(overflow.status).toBe(429);
  });
});
