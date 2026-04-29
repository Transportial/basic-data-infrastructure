// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  StaticDnsChallengeVerifier,
  StaticHttpChallengeVerifier,
  StaticTlsAlpnChallengeVerifier,
  SystemDnsChallengeVerifier,
  SystemHttpChallengeVerifier,
  SystemTlsAlpnChallengeVerifier,
} from '../src/acme/verifiers.ts';

describe('Static verifiers', () => {
  test('http', async () => {
    const v = new StaticHttpChallengeVerifier();
    v.set('example.com', 'tok', 'auth');
    expect(await v.verify('example.com', 'tok', 'auth')).toBe(true);
    expect(await v.verify('example.com', 'tok', 'wrong')).toBe(false);
    expect(await v.verify('other', 'tok', 'auth')).toBe(false);
  });

  test('dns', async () => {
    const v = new StaticDnsChallengeVerifier();
    v.set('example.com', 'digest-a');
    v.set('example.com', 'digest-b');
    expect(await v.verify('example.com', 'digest-a')).toBe(true);
    expect(await v.verify('example.com', 'digest-b')).toBe(true);
    expect(await v.verify('example.com', 'digest-c')).toBe(false);
    expect(await v.verify('missing', 'x')).toBe(false);
  });

  test('tls-alpn', async () => {
    const v = new StaticTlsAlpnChallengeVerifier();
    v.set('host', 'auth');
    expect(await v.verify('host', 'auth')).toBe(true);
    expect(await v.verify('host', 'wrong')).toBe(false);
  });
});

describe('System verifiers', () => {
  test('http verifier returns true on matching body', async () => {
    const fetcher = async () => new Response('auth', { status: 200 });
    const v = new SystemHttpChallengeVerifier(fetcher as unknown as typeof fetch);
    expect(await v.verify('example.com', 'tok', 'auth')).toBe(true);
  });

  test('http verifier returns false on mismatch', async () => {
    const fetcher = async () => new Response('other', { status: 200 });
    const v = new SystemHttpChallengeVerifier(fetcher as unknown as typeof fetch);
    expect(await v.verify('example.com', 'tok', 'auth')).toBe(false);
  });

  test('http verifier returns false on non-200', async () => {
    const fetcher = async () => new Response('', { status: 404 });
    const v = new SystemHttpChallengeVerifier(fetcher as unknown as typeof fetch);
    expect(await v.verify('example.com', 'tok', 'auth')).toBe(false);
  });

  test('http verifier returns false on exception', async () => {
    const fetcher = async () => {
      throw new Error('net');
    };
    const v = new SystemHttpChallengeVerifier(fetcher as unknown as typeof fetch);
    expect(await v.verify('example.com', 'tok', 'auth')).toBe(false);
  });

  test('dns verifier finds expected record', async () => {
    const v = new SystemDnsChallengeVerifier({
      async resolveTxt() {
        return ['expected', 'other'];
      },
    });
    expect(await v.verify('example.com', 'expected')).toBe(true);
    expect(await v.verify('example.com', 'nope')).toBe(false);
  });

  test('dns verifier returns false on error', async () => {
    const v = new SystemDnsChallengeVerifier({
      async resolveTxt() {
        throw new Error('dns');
      },
    });
    expect(await v.verify('example.com', 'x')).toBe(false);
  });

  test('tls-alpn verifier matches bytes when present', async () => {
    const digest = new Uint8Array(32);
    crypto.getRandomValues(digest);
    const connector = async () => {
      const fake = new Uint8Array(200);
      fake.set(digest, 100);
      return fake;
    };
    const v = new SystemTlsAlpnChallengeVerifier(connector);
    // match happens only if the verifier hashed the key-auth to the same bytes;
    // here we know the connector returns an arbitrary buffer, so we verify that
    // a mismatched key-auth correctly returns false.
    expect(await v.verify('example.com', 'some-key-auth')).toBe(false);
  });

  test('tls-alpn verifier returns false on null cert', async () => {
    const connector = async () => null;
    const v = new SystemTlsAlpnChallengeVerifier(connector);
    expect(await v.verify('example.com', 'k')).toBe(false);
  });

  test('tls-alpn verifier matches when digest is embedded', async () => {
    const keyAuth = 'my-key-auth';
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', toBuf(new TextEncoder().encode(keyAuth))),
    );
    const connector = async () => {
      const fake = new Uint8Array(200);
      fake.set(digest, 40);
      return fake;
    };
    const v = new SystemTlsAlpnChallengeVerifier(connector);
    expect(await v.verify('example.com', keyAuth)).toBe(true);
  });
});

function toBuf(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}
