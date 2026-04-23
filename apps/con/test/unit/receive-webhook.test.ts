// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { FakeClock, base64UrlEncode } from '@bdi/kernel';
import { FakeEventBus } from '@bdi/testing';
import { compactSign, HmacSigner, InMemoryTrustlist } from '@bdi/crypto';
import {
  InMemoryReplayCache,
  ReceiveWebhookUseCase,
} from '../../src/application/use-cases/receive-webhook.ts';

async function sha256B64(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let s = '';
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function buildSetup() {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const signer = new HmacSigner(key);
  const list = new InMemoryTrustlist();
  list.add({ kid: 'k-1', signer });
  const cache = new InMemoryReplayCache();
  const bus = new FakeEventBus();
  const uc = new ReceiveWebhookUseCase(
    list,
    cache,
    new FakeClock(),
    bus,
    { allowedIssuers: ['https://asr.test', 'https://ors.test'] },
    'ctn',
  );
  return { uc, signer, list, cache, bus };
}

async function signEnvelope(signer: HmacSigner, body: string): Promise<string> {
  const bodyHash = await sha256B64(new TextEncoder().encode(body));
  return compactSign({ body_sha256: bodyHash, iss: 'https://asr.test' }, signer, {
    kid: 'k-1',
    alg: 'ES256',
  });
}

describe('ReceiveWebhookUseCase', () => {
  test('happy path', async () => {
    const s = await buildSetup();
    const body = JSON.stringify({ hello: 'world' });
    const jws = await signEnvelope(s.signer, body);
    const r = await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 'ors.context.event-occurred',
      issuer: 'https://asr.test',
      body,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.payload).toEqual({ hello: 'world' });
  });

  test('missing headers', async () => {
    const s = await buildSetup();
    const r = await s.uc.execute({
      jws: '',
      eventId: '',
      eventType: '',
      issuer: 'https://asr.test',
      body: '',
    });
    expect(!r.ok && r.error.type).toBe('missing-headers');
  });

  test('issuer-not-allowed', async () => {
    const s = await buildSetup();
    const body = '{}';
    const jws = await signEnvelope(s.signer, body);
    const r = await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://evil',
      body,
    });
    expect(!r.ok && r.error.type).toBe('issuer-not-allowed');
  });

  test('replay-detected', async () => {
    const s = await buildSetup();
    const body = '{}';
    const jws = await signEnvelope(s.signer, body);
    await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://asr.test',
      body,
    });
    const r = await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://asr.test',
      body,
    });
    expect(!r.ok && r.error.type).toBe('replay-detected');
  });

  test('signature-invalid', async () => {
    const s = await buildSetup();
    const r = await s.uc.execute({
      jws: 'not.a.jws',
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://asr.test',
      body: '{}',
    });
    expect(!r.ok && r.error.type).toBe('signature-invalid');
  });

  test('body-hash-mismatch', async () => {
    const s = await buildSetup();
    const jws = await signEnvelope(s.signer, '{"a":1}');
    const r = await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://asr.test',
      body: '{"a":2}',
    });
    expect(!r.ok && r.error.type).toBe('body-hash-mismatch');
  });

  test('non-JSON body returned as string', async () => {
    const s = await buildSetup();
    const body = 'plain text';
    const jws = await signEnvelope(s.signer, body);
    const r = await s.uc.execute({
      jws,
      eventId: 'e-1',
      eventType: 't',
      issuer: 'https://asr.test',
      body,
    });
    expect(r.ok && r.value.payload).toBe('plain text');
  });
});

describe('InMemoryReplayCache', () => {
  test('seen returns false for unknown', async () => {
    const c = new InMemoryReplayCache();
    expect(await c.seen('x')).toBe(false);
  });
  test('remember + seen', async () => {
    const c = new InMemoryReplayCache();
    await c.remember('x', 60);
    expect(await c.seen('x')).toBe(true);
  });
  test('expired entry is purged', async () => {
    const c = new InMemoryReplayCache();
    await c.remember('x', -1);
    expect(await c.seen('x')).toBe(false);
  });
});

// unused imports for type check
void base64UrlEncode;
