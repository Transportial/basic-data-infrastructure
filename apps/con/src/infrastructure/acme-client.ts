// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  AcmeClient,
  type AcmeHttpTransport,
  type ChallengeSolver,
} from '@transportial/crypto-ca';

// A CON-side ACME client convenience wrapper. The solver is pluggable: a
// production connector publishes the key-authorization file behind its own
// web server (http-01) or updates DNS via the operator's DNS provider (dns-01).
// The `renewCertificate` method walks the full RFC 8555 flow and returns the
// issued PEM + serial so the caller can persist both and rotate mTLS.

export interface RenewOptions {
  readonly directoryUrl: string;
  readonly eab: { kid: string; hmacKey: Uint8Array };
  readonly identifiers: ReadonlyArray<{ type: 'dns' | 'ip'; value: string }>;
  readonly csrDer: Uint8Array;
  readonly solvers: ReadonlyArray<ChallengeSolver>;
  readonly transport?: AcmeHttpTransport;
  readonly contact?: ReadonlyArray<string>;
}

export interface RenewResult {
  readonly pem: string;
  readonly serial: string;
  readonly accountUrl: string;
}

export async function renewCertificate(options: RenewOptions): Promise<RenewResult> {
  const client = new AcmeClient({
    directoryUrl: options.directoryUrl,
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
  });
  const accountUrl = await client.newAccount({
    eab: options.eab,
    ...(options.contact !== undefined ? { contact: options.contact } : {}),
    termsOfServiceAgreed: true,
  });
  const order = await client.newOrder(options.identifiers);
  for (const authzUrl of order.authorizations) {
    const authz = await client.getAuthorization(authzUrl);
    await client.solveAndRespond(authz, options.solvers);
  }
  const finalized = await client.finalize(order, options.csrDer);
  if (!finalized.certificate) throw new Error('finalize returned no certificate URL');
  const pem = await client.fetchCertificate(finalized.certificate);
  const serial = finalized.certificate.split('/').pop() ?? '';
  return { pem, serial, accountUrl };
}

// Pluggable solvers that can be used directly in tests or wired to a real
// webserver/DNS API in production.
export class MemoryHttpChallengeSolver implements ChallengeSolver {
  readonly answers = new Map<string, string>();
  canSolve(type: string): boolean {
    return type === 'http-01';
  }
  async present(identifier: string, token: string, keyAuthorization: string): Promise<void> {
    this.answers.set(`${identifier}/${token}`, keyAuthorization);
  }
  async cleanup(identifier: string, token: string): Promise<void> {
    this.answers.delete(`${identifier}/${token}`);
  }
  resolve(identifier: string, token: string): string | undefined {
    return this.answers.get(`${identifier}/${token}`);
  }
}
