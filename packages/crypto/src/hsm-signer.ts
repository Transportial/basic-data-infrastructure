// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import type { RawSigner } from './jws.ts';

// Abstract HSM backend port. Production operators plug in:
// - node-pkcs11 for direct PKCS#11 HSM access
// - AWS KMS / GCP KMS / Azure Key Vault for managed key services
// - step-ca REST API for CA-backed signing
// The runtime never sees the private key material.

export interface HsmBackend {
  readonly label: string;
  sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;
  verify?(keyId: string, data: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export class HsmSigner implements RawSigner {
  constructor(
    private readonly backend: HsmBackend,
    private readonly keyId: string,
  ) {}

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return this.backend.sign(this.keyId, payload);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (this.backend.verify) return this.backend.verify(this.keyId, payload, signature);
    // Some HSM backends (notably KMS) don't expose verify; in that case we
    // fall back to assuming the local operation succeeds and expect callers
    // to use a separate RawSigner for verification.
    return false;
  }
}

// Pkcs11Backend delegates sign operations to a long-lived PKCS#11 handle held
// by the operator's process. The handle interface is intentionally minimal so
// operators can satisfy it with either node-pkcs11 or a native module.
export interface Pkcs11Handle {
  signEcdsa(keyHandle: Uint8Array, data: Uint8Array, hash: 'SHA-256' | 'SHA-384'): Promise<Uint8Array>;
  signEdDsa(keyHandle: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  signRsaPss(keyHandle: Uint8Array, data: Uint8Array, hash: 'SHA-256'): Promise<Uint8Array>;
}

export interface Pkcs11BackendOptions {
  readonly handle: Pkcs11Handle;
  readonly keyHandles: Readonly<Record<string, Uint8Array>>;
  readonly alg: Readonly<Record<string, 'ES256' | 'ES384' | 'EdDSA' | 'PS256'>>;
}

export class Pkcs11Backend implements HsmBackend {
  readonly label = 'pkcs11';
  constructor(private readonly options: Pkcs11BackendOptions) {}

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const handle = this.options.keyHandles[keyId];
    if (!handle) throw new Error(`pkcs11: unknown keyId ${keyId}`);
    const alg = this.options.alg[keyId];
    if (!alg) throw new Error(`pkcs11: no alg for ${keyId}`);
    switch (alg) {
      case 'ES256':
        return this.options.handle.signEcdsa(handle, data, 'SHA-256');
      case 'ES384':
        return this.options.handle.signEcdsa(handle, data, 'SHA-384');
      case 'EdDSA':
        return this.options.handle.signEdDsa(handle, data);
      case 'PS256':
        return this.options.handle.signRsaPss(handle, data, 'SHA-256');
    }
  }
}

// StepCaBackend calls step-ca's REST API to sign a pre-hashed digest.
// Operators point this at their internal step-ca instance; the adapter handles
// bearer-token auth and retries on 5xx.
export interface StepCaBackendOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetcher?: typeof fetch;
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

export class StepCaBackend implements HsmBackend {
  readonly label = 'step-ca';
  constructor(private readonly options: StepCaBackendOptions) {}

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/1.0/sign`;
    const body = JSON.stringify({
      keyId,
      digest: base64(data),
      alg: 'SHA256',
    });
    const retries = this.options.retries ?? 3;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.token}`,
            'content-type': 'application/json',
          },
          body,
        });
        if (res.status === 200) {
          const json = (await res.json()) as { signature: string };
          return decodeBase64(json.signature);
        }
        if (res.status >= 500) {
          lastErr = new Error(`step-ca ${res.status}`);
          if (attempt === retries - 1) break;
          await new Promise((r) => setTimeout(r, this.options.retryDelayMs ?? 200));
          continue;
        }
        // 4xx is a permanent client error — fail fast without retrying.
        throw new Error(`step-ca error ${res.status}`);
      } catch (e) {
        lastErr = e;
        // Permanent client errors escape the loop immediately.
        if (
          e instanceof Error &&
          /^step-ca error 4/.test(e.message)
        ) {
          break;
        }
        if (attempt === retries - 1) break;
        await new Promise((r) => setTimeout(r, this.options.retryDelayMs ?? 200));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
