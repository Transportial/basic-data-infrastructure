// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import {
  HsmSigner,
  Pkcs11Backend,
  StepCaBackend,
  type HsmBackend,
  type Pkcs11Handle,
} from '../src/hsm-signer.ts';

describe('HsmSigner', () => {
  test('delegates sign to backend', async () => {
    const backend: HsmBackend = {
      label: 'test',
      async sign(keyId, data) {
        return Uint8Array.from([keyId.length, data.length]);
      },
    };
    const signer = new HsmSigner(backend, 'my-key');
    const out = await signer.sign(new Uint8Array([1, 2, 3]));
    expect(out[0]).toBe(6);
    expect(out[1]).toBe(3);
  });

  test('verify delegates when backend exposes it', async () => {
    const backend: HsmBackend = {
      label: 'test',
      async sign() {
        return new Uint8Array();
      },
      async verify(keyId, _data, _sig) {
        return keyId === 'correct';
      },
    };
    const signer = new HsmSigner(backend, 'correct');
    expect(await signer.verify(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  test('verify returns false when backend has no verify', async () => {
    const backend: HsmBackend = {
      label: 'test',
      async sign() {
        return new Uint8Array();
      },
    };
    const signer = new HsmSigner(backend, 'k');
    expect(await signer.verify(new Uint8Array(), new Uint8Array())).toBe(false);
  });
});

describe('Pkcs11Backend', () => {
  function fakeHandle(): Pkcs11Handle {
    return {
      async signEcdsa(handle, data, hash) {
        return Uint8Array.from([handle.length, data.length, hash === 'SHA-256' ? 1 : 2]);
      },
      async signEdDsa(handle, data) {
        return Uint8Array.from([handle.length, data.length, 42]);
      },
      async signRsaPss(handle, data) {
        return Uint8Array.from([handle.length, data.length, 99]);
      },
    };
  }

  test('ES256 sign routes to ECDSA SHA-256', async () => {
    const handle = Uint8Array.from([1, 2, 3]);
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: { 'asr-ca': handle },
      alg: { 'asr-ca': 'ES256' },
    });
    const out = await backend.sign('asr-ca', Uint8Array.from([9, 9]));
    expect(out[2]).toBe(1);
  });

  test('ES384', async () => {
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: { k: new Uint8Array(5) },
      alg: { k: 'ES384' },
    });
    const out = await backend.sign('k', new Uint8Array());
    expect(out[2]).toBe(2);
  });

  test('EdDSA', async () => {
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: { k: new Uint8Array(5) },
      alg: { k: 'EdDSA' },
    });
    const out = await backend.sign('k', new Uint8Array());
    expect(out[2]).toBe(42);
  });

  test('PS256', async () => {
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: { k: new Uint8Array(5) },
      alg: { k: 'PS256' },
    });
    const out = await backend.sign('k', new Uint8Array());
    expect(out[2]).toBe(99);
  });

  test('unknown keyId throws', async () => {
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: {},
      alg: {},
    });
    await expect(backend.sign('missing', new Uint8Array())).rejects.toThrow();
  });

  test('missing alg throws', async () => {
    const backend = new Pkcs11Backend({
      handle: fakeHandle(),
      keyHandles: { k: new Uint8Array() },
      alg: {},
    });
    await expect(backend.sign('k', new Uint8Array())).rejects.toThrow();
  });
});

describe('StepCaBackend', () => {
  test('happy path returns decoded signature', async () => {
    let url = '';
    const fetcher = (async (u: RequestInfo | URL) => {
      url = String(u);
      return new Response(JSON.stringify({ signature: 'AQID' }), { status: 200 });
    }) as unknown as typeof fetch;
    const backend = new StepCaBackend({ baseUrl: 'https://stepca', token: 't', fetcher });
    const out = await backend.sign('my-key', Uint8Array.from([1, 2]));
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(url).toBe('https://stepca/1.0/sign');
  });

  test('5xx is retried and ultimately fails', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;
    const backend = new StepCaBackend({
      baseUrl: 'https://stepca',
      token: 't',
      fetcher,
      retries: 3,
      retryDelayMs: 1,
    });
    await expect(backend.sign('k', new Uint8Array())).rejects.toThrow();
    expect(calls).toBe(3);
  });

  test('4xx fails fast without retry', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response('unauthorized', { status: 401 });
    }) as unknown as typeof fetch;
    const backend = new StepCaBackend({
      baseUrl: 'https://stepca',
      token: 't',
      fetcher,
      retries: 5,
      retryDelayMs: 1,
    });
    await expect(backend.sign('k', new Uint8Array())).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('transport error retried', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw new Error('net');
    }) as unknown as typeof fetch;
    const backend = new StepCaBackend({
      baseUrl: 'https://stepca',
      token: 't',
      fetcher,
      retries: 2,
      retryDelayMs: 1,
    });
    await expect(backend.sign('k', new Uint8Array())).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
