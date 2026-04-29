// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  base64UrlDecode,
  base64UrlEncode,
  type Jwk,
} from '@transportial/kernel';
import { JwkSigner, publicJwk, type KeyAlg } from '@transportial/crypto';

// A complete ACME client able to talk to any RFC 8555-compliant server. It
// owns its account key, signs protected JWS payloads, solves http-01 and
// dns-01 challenges via pluggable handlers, and retrieves the final
// certificate as PEM.

export interface AcmeHttpTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface AcmeClientOptions {
  readonly directoryUrl: string;
  readonly accountAlg?: KeyAlg;
  readonly transport?: AcmeHttpTransport;
}

export interface AcmeDirectory {
  readonly newNonce: string;
  readonly newAccount: string;
  readonly newOrder: string;
  readonly revokeCert: string;
  readonly keyChange?: string;
  readonly meta?: {
    termsOfService?: string;
    website?: string;
    externalAccountRequired?: boolean;
  };
}

export interface NewAccountOptions {
  readonly contact?: ReadonlyArray<string>;
  readonly termsOfServiceAgreed?: boolean;
  readonly eab: {
    readonly kid: string;
    readonly hmacKey: Uint8Array;
  };
}

export interface OrderIdentifier {
  readonly type: 'dns' | 'ip';
  readonly value: string;
}

export interface RemoteOrder {
  readonly status: string;
  readonly expires: string;
  readonly identifiers: ReadonlyArray<OrderIdentifier>;
  readonly authorizations: ReadonlyArray<string>;
  readonly finalize: string;
  readonly certificate?: string;
  readonly url: string;
}

export interface RemoteAuthorization {
  readonly status: string;
  readonly identifier: OrderIdentifier;
  readonly challenges: ReadonlyArray<{
    type: string;
    status: string;
    url: string;
    token: string;
  }>;
  readonly url: string;
}

export interface ChallengeSolver {
  canSolve(type: string): boolean;
  // Called *before* the client asks the server to validate the challenge.
  present(identifier: string, token: string, keyAuthorization: string): Promise<void>;
  // Called after success or failure to clean up external state (e.g. DNS records).
  cleanup?(identifier: string, token: string, keyAuthorization: string): Promise<void>;
}

export class AcmeClient {
  private directory: AcmeDirectory | null = null;
  private accountUrl: string | null = null;
  private accountSigner: JwkSigner | null = null;
  private accountJwk: Jwk | null = null;
  private accountPrivateJwk: Jwk | null = null;
  private alg: KeyAlg;
  private readonly transport: AcmeHttpTransport;

  constructor(private readonly options: AcmeClientOptions) {
    this.alg = options.accountAlg ?? 'ES256';
    this.transport = options.transport ?? { fetch: fetch.bind(globalThis) };
  }

  async getDirectory(): Promise<AcmeDirectory> {
    if (this.directory) return this.directory;
    const res = await this.transport.fetch(this.options.directoryUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (res.status !== 200) throw new Error(`directory fetch failed: ${res.status}`);
    this.directory = (await res.json()) as AcmeDirectory;
    return this.directory;
  }

  async fetchNonce(): Promise<string> {
    const dir = await this.getDirectory();
    const res = await this.transport.fetch(dir.newNonce, { method: 'HEAD' });
    const nonce = res.headers.get('replay-nonce');
    if (!nonce) throw new Error('no replay-nonce in response');
    return nonce;
  }

  async newAccount(opts: NewAccountOptions): Promise<string> {
    const dir = await this.getDirectory();
    const { JwkSigner: JwkSignerCtor, generateKeyPair: genKey } = await import('@transportial/crypto');
    const pair = await genKey(this.alg);
    this.accountPrivateJwk = pair.privateJwk;
    this.accountJwk = publicJwk(pair.publicJwk);
    this.accountSigner = new JwkSignerCtor(pair.privateJwk, this.alg);

    const eabProtected = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify({ kid: opts.eab.kid, alg: 'HS256' })),
    );
    const eabPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(this.accountJwk)));
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      toBuf(opts.eab.hmacKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const eabSig = await crypto.subtle.sign(
      'HMAC',
      hmacKey,
      toBuf(new TextEncoder().encode(`${eabProtected}.${eabPayload}`)),
    );
    const body = {
      contact: opts.contact ?? [],
      termsOfServiceAgreed: opts.termsOfServiceAgreed ?? true,
      externalAccountBinding: {
        protected: eabProtected,
        payload: eabPayload,
        signature: base64UrlEncode(new Uint8Array(eabSig)),
      },
    };

    const nonce = await this.fetchNonce();
    const res = await this.postJws(dir.newAccount, body, { nonce, useJwk: true });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`newAccount failed: ${res.status} ${await res.text()}`);
    }
    const loc = res.headers.get('location');
    if (!loc) throw new Error('newAccount: missing Location header');
    this.accountUrl = loc;
    return loc;
  }

  async newOrder(identifiers: ReadonlyArray<OrderIdentifier>): Promise<RemoteOrder> {
    const dir = await this.getDirectory();
    if (!this.accountUrl || !this.accountSigner) throw new Error('no account');
    const nonce = await this.fetchNonce();
    const res = await this.postJws(dir.newOrder, { identifiers }, { nonce });
    if (res.status !== 201) throw new Error(`newOrder failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as Record<string, unknown>;
    const url = res.headers.get('location')!;
    return toRemoteOrder(json, url);
  }

  async getOrder(url: string): Promise<RemoteOrder> {
    const nonce = await this.fetchNonce();
    const res = await this.postJws(url, '', { nonce });
    if (res.status !== 200) throw new Error(`getOrder failed: ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return toRemoteOrder(json, url);
  }

  async getAuthorization(url: string): Promise<RemoteAuthorization> {
    const nonce = await this.fetchNonce();
    const res = await this.postJws(url, '', { nonce });
    if (res.status !== 200) throw new Error(`getAuthorization failed: ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return toRemoteAuthorization(json, url);
  }

  async solveAndRespond(
    authz: RemoteAuthorization,
    solvers: ReadonlyArray<ChallengeSolver>,
  ): Promise<void> {
    if (!this.accountJwk) throw new Error('no account');
    const solver = solvers.find((s) => authz.challenges.some((c) => s.canSolve(c.type)));
    if (!solver) throw new Error('no solver can handle the challenges');
    const challenge = authz.challenges.find((c) => solver.canSolve(c.type))!;

    const keyAuth = await keyAuthorization(this.accountJwk, challenge.token);
    const identifier = authz.identifier.value;
    await solver.present(identifier, challenge.token, keyAuth);
    try {
      const nonce = await this.fetchNonce();
      const res = await this.postJws(challenge.url, {}, { nonce });
      if (res.status !== 200) throw new Error(`challenge respond failed: ${res.status}`);
    } finally {
      await solver.cleanup?.(identifier, challenge.token, keyAuth);
    }
  }

  async finalize(order: RemoteOrder, csrDer: Uint8Array): Promise<RemoteOrder> {
    const nonce = await this.fetchNonce();
    const res = await this.postJws(
      order.finalize,
      { csr: base64UrlEncode(csrDer) },
      { nonce },
    );
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return toRemoteOrder(json, order.url);
  }

  async fetchCertificate(certUrl: string): Promise<string> {
    const nonce = await this.fetchNonce();
    const res = await this.postJws(certUrl, '', { nonce });
    if (res.status !== 200) throw new Error(`cert fetch failed: ${res.status}`);
    return res.text();
  }

  async revoke(certSerial: string, reason?: number): Promise<void> {
    const dir = await this.getDirectory();
    const nonce = await this.fetchNonce();
    const res = await this.postJws(
      dir.revokeCert,
      { serial: certSerial, ...(reason !== undefined ? { reason } : {}) },
      { nonce },
    );
    if (res.status !== 200) throw new Error(`revoke failed: ${res.status}`);
  }

  getAccountPrivateJwk(): Jwk | null {
    return this.accountPrivateJwk;
  }

  private async postJws(
    url: string,
    payload: unknown,
    opts: { nonce: string; useJwk?: boolean },
  ): Promise<Response> {
    if (!this.accountSigner) throw new Error('client has no account signer');
    const protectedHeader: Record<string, unknown> = {
      alg: bdiAlgToAcmeAlg(this.alg),
      nonce: opts.nonce,
      url,
    };
    if (opts.useJwk) {
      if (!this.accountJwk) throw new Error('no account jwk');
      protectedHeader.jwk = this.accountJwk;
    } else {
      if (!this.accountUrl) throw new Error('no account url');
      protectedHeader.kid = this.accountUrl;
    }
    const protectedB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(protectedHeader)));
    const payloadB64 =
      payload === ''
        ? ''
        : base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await this.accountSigner.sign(new TextEncoder().encode(`${protectedB64}.${payloadB64}`));
    const body = JSON.stringify({
      protected: protectedB64,
      payload: payloadB64,
      signature: base64UrlEncode(sig),
    });
    return this.transport.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body,
    });
  }
}

function toRemoteOrder(json: Record<string, unknown>, url: string): RemoteOrder {
  return {
    status: String(json.status ?? ''),
    expires: String(json.expires ?? ''),
    identifiers: Array.isArray(json.identifiers) ? (json.identifiers as OrderIdentifier[]) : [],
    authorizations: Array.isArray(json.authorizations) ? (json.authorizations as string[]) : [],
    finalize: String(json.finalize ?? ''),
    ...(typeof json.certificate === 'string' ? { certificate: json.certificate } : {}),
    url,
  };
}

function toRemoteAuthorization(json: Record<string, unknown>, url: string): RemoteAuthorization {
  return {
    status: String(json.status ?? ''),
    identifier: (json.identifier ?? { type: 'dns', value: '' }) as OrderIdentifier,
    challenges: Array.isArray(json.challenges)
      ? (json.challenges as Array<{ type: string; status: string; url: string; token: string }>)
      : [],
    url,
  };
}

function bdiAlgToAcmeAlg(alg: KeyAlg): string {
  return alg; // same strings
}

export async function keyAuthorization(jwk: Jwk, token: string): Promise<string> {
  const { jwkThumbprint } = await import('@transportial/kernel');
  const thumb = await jwkThumbprint(jwk);
  return `${token}.${thumb}`;
}

function toBuf(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export { base64UrlDecode, JwkSigner };
