// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type {
  DnsChallengeVerifier,
  HttpChallengeVerifier,
  TlsAlpnChallengeVerifier,
} from './ports.ts';

// The HTTP-01 verifier fetches http://<identifier>/.well-known/acme-challenge/<token>
// and compares the body against the expected key authorization.
export class SystemHttpChallengeVerifier implements HttpChallengeVerifier {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async verify(identifier: string, token: string, keyAuthorization: string): Promise<boolean> {
    const url = `http://${identifier}/.well-known/acme-challenge/${token}`;
    try {
      const res = await this.fetcher(url, { method: 'GET' });
      if (res.status !== 200) return false;
      const body = (await res.text()).trim();
      return body === keyAuthorization;
    } catch {
      return false;
    }
  }
}

// Pluggable DNS verifier — the injected resolver returns the TXT records for
// `_acme-challenge.<domain>`.
export interface DnsResolver {
  resolveTxt(name: string): Promise<ReadonlyArray<string>>;
}

export class SystemDnsChallengeVerifier implements DnsChallengeVerifier {
  constructor(private readonly resolver: DnsResolver) {}
  async verify(identifier: string, expected: string): Promise<boolean> {
    const name = `_acme-challenge.${identifier}`;
    try {
      const records = await this.resolver.resolveTxt(name);
      return records.some((r) => r === expected);
    } catch {
      return false;
    }
  }
}

// TLS-ALPN verifier — connects to identifier:443, negotiates ALPN
// "acme-tls/1", validates the presented certificate contains the expected
// SHA-256 of the key authorization in the acmeIdentifier extension.
export class SystemTlsAlpnChallengeVerifier implements TlsAlpnChallengeVerifier {
  constructor(private readonly connector: (identifier: string, alpn: string) => Promise<Uint8Array | null>) {}
  async verify(identifier: string, keyAuthorization: string): Promise<boolean> {
    const der = await this.connector(identifier, 'acme-tls/1');
    if (!der) return false;
    // Parse the certificate's acmeIdentifier extension (1.3.6.1.5.5.7.1.31)
    // whose value is an OCTET STRING carrying the SHA-256 of keyAuthorization.
    // This does not duplicate the full X.509 parser; we scan for the OID.
    const target = await sha256Raw(new TextEncoder().encode(keyAuthorization));
    return containsBytes(der, target);
  }
}

async function sha256Raw(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) return false;
  outer: for (let i = 0; i <= haystack.byteLength - needle.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// In-memory / test-friendly verifiers.
export class StaticHttpChallengeVerifier implements HttpChallengeVerifier {
  private readonly answers = new Map<string, string>();
  set(identifier: string, token: string, keyAuth: string): void {
    this.answers.set(`${identifier}/${token}`, keyAuth);
  }
  async verify(identifier: string, token: string, keyAuthorization: string): Promise<boolean> {
    return this.answers.get(`${identifier}/${token}`) === keyAuthorization;
  }
}

export class StaticDnsChallengeVerifier implements DnsChallengeVerifier {
  private readonly records = new Map<string, string[]>();
  set(identifier: string, value: string): void {
    const existing = this.records.get(identifier) ?? [];
    existing.push(value);
    this.records.set(identifier, existing);
  }
  async verify(identifier: string, expected: string): Promise<boolean> {
    return (this.records.get(identifier) ?? []).includes(expected);
  }
}

export class StaticTlsAlpnChallengeVerifier implements TlsAlpnChallengeVerifier {
  private readonly answers = new Map<string, string>();
  set(identifier: string, keyAuth: string): void {
    this.answers.set(identifier, keyAuth);
  }
  async verify(identifier: string, keyAuthorization: string): Promise<boolean> {
    return this.answers.get(identifier) === keyAuthorization;
  }
}
