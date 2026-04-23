// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import {
  base64UrlDecode,
  base64UrlEncode,
  err,
  jwkThumbprint,
  ok,
  validatePublicJwk,
  type Jwk,
  type Result,
} from '@bdi/kernel';
import type {
  AcmeAccount,
  AcmeOrder,
  Authorization,
  Challenge,
  ChallengeType,
  Identifier,
  IssuedCertificate,
} from './types.ts';
import type {
  AccountRepository,
  AuthorizationRepository,
  CertificateRepository,
  DnsChallengeVerifier,
  EabStore,
  HttpChallengeVerifier,
  NonceStore,
  OrderRepository,
  TlsAlpnChallengeVerifier,
} from './ports.ts';
import { parseCsr, verifyCsrSignature } from '../csr.ts';
import {
  attachSignature,
  buildTbsCertificate,
  fromPem,
  toPem,
  type CertProfile,
  type SubjectDn,
} from '../x509.ts';
import { OID } from '../oid.ts';

export interface AcmeServerConfig {
  readonly directoryBaseUrl: string;
  readonly termsOfService?: string;
  readonly website?: string;
  readonly orderLifetimeSeconds: number;
  readonly authorizationLifetimeSeconds: number;
  readonly certificateLifetimeSeconds: number;
  readonly caIssuerDn: SubjectDn;
  readonly caPublicJwk: Jwk;
  readonly crlDistributionUrl: string;
  readonly ocspUrl: string;
  readonly caIssuersUrl: string;
  readonly challengeTypes: ReadonlyArray<ChallengeType>;
}

export interface Clock {
  nowIso(): string;
  nowUnix(): number;
}

export interface IdPort {
  newId(prefix: string): string;
}

export interface CaSigner {
  sign(tbs: Uint8Array): Promise<Uint8Array>;
  readonly algorithmOid: string;
}

export interface AcmeServices {
  readonly accounts: AccountRepository;
  readonly orders: OrderRepository;
  readonly authorizations: AuthorizationRepository;
  readonly certificates: CertificateRepository;
  readonly nonces: NonceStore;
  readonly eab: EabStore;
  readonly http01: HttpChallengeVerifier;
  readonly dns01: DnsChallengeVerifier;
  readonly tlsAlpn01: TlsAlpnChallengeVerifier;
  readonly signer: CaSigner;
  readonly clock: Clock;
  readonly ids: IdPort;
  readonly config: AcmeServerConfig;
}

export type NewAccountError =
  | { type: 'invalid-jwk' }
  | { type: 'terms-not-agreed' }
  | { type: 'eab-required' }
  | { type: 'eab-unknown-kid' }
  | { type: 'eab-bad-signature' }
  | { type: 'eab-already-used' };

export interface NewAccountInput {
  readonly jwk: unknown;
  readonly contact?: ReadonlyArray<string>;
  readonly termsOfServiceAgreed: boolean;
  readonly externalAccountBinding: {
    readonly protected: { kid: string; alg: 'HS256' };
    readonly payload: string;
    readonly signature: string;
  };
}

export class NewAccountUseCase {
  constructor(private readonly s: AcmeServices) {}

  async execute(input: NewAccountInput): Promise<Result<AcmeAccount, NewAccountError>> {
    const validated = validatePublicJwk(input.jwk);
    if (!validated.ok) return err({ type: 'invalid-jwk' });
    if (!input.termsOfServiceAgreed) return err({ type: 'terms-not-agreed' });

    const eab = await this.s.eab.find(input.externalAccountBinding.protected.kid);
    if (!eab) return err({ type: 'eab-unknown-kid' });
    if (eab.usedAt) return err({ type: 'eab-already-used' });

    // Verify EAB inner JWS: HS256 over "<protected>.<payload>" with the
    // operator-provisioned HMAC key. The payload is the base64url of the
    // account key JWK being registered.
    const protectedB64 = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(input.externalAccountBinding.protected)),
    );
    const signingInput = new TextEncoder().encode(
      `${protectedB64}.${input.externalAccountBinding.payload}`,
    );
    const key = await crypto.subtle.importKey(
      'raw',
      toBuffer(eab.hmacKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      'HMAC',
      key,
      toBuffer(base64UrlDecode(input.externalAccountBinding.signature)),
      toBuffer(signingInput),
    );
    if (!verified) return err({ type: 'eab-bad-signature' });

    const expectedPayload = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(validated.value)),
    );
    if (expectedPayload !== input.externalAccountBinding.payload) {
      return err({ type: 'eab-bad-signature' });
    }

    const id = this.s.ids.newId('acct');
    const account: AcmeAccount = {
      id,
      status: 'valid',
      contact: input.contact ?? [],
      termsOfServiceAgreed: true,
      orders: `${this.s.config.directoryBaseUrl}/acme/accounts/${id}/orders`,
      createdAt: this.s.clock.nowIso(),
      publicJwk: validated.value,
      externalAccountKid: eab.kid,
    };
    await this.s.accounts.save(account);
    await this.s.eab.markUsed(eab.kid, this.s.clock.nowIso());
    return ok(account);
  }
}

export type NewOrderError =
  | { type: 'unknown-account'; accountId: string }
  | { type: 'account-not-valid' }
  | { type: 'no-identifiers' }
  | { type: 'unsupported-identifier-type'; value: string };

export interface NewOrderInput {
  readonly accountId: string;
  readonly identifiers: ReadonlyArray<Identifier>;
  readonly notBefore?: string;
  readonly notAfter?: string;
}

export class NewOrderUseCase {
  constructor(private readonly s: AcmeServices) {}

  async execute(input: NewOrderInput): Promise<Result<AcmeOrder, NewOrderError>> {
    const account = await this.s.accounts.find(input.accountId);
    if (!account) return err({ type: 'unknown-account', accountId: input.accountId });
    if (account.status !== 'valid') return err({ type: 'account-not-valid' });
    if (input.identifiers.length === 0) return err({ type: 'no-identifiers' });
    for (const id of input.identifiers) {
      if (id.type !== 'dns' && id.type !== 'ip') {
        return err({ type: 'unsupported-identifier-type', value: id.type });
      }
    }

    const orderId = this.s.ids.newId('order');
    const authorizations: Authorization[] = [];
    for (const id of input.identifiers) {
      const authzId = this.s.ids.newId('authz');
      const challenges: Challenge[] = this.s.config.challengeTypes.map((type) => {
        const challengeId = this.s.ids.newId('chall');
        return {
          id: challengeId,
          type,
          status: 'pending',
          url: `${this.s.config.directoryBaseUrl}/acme/challenge/${authzId}/${challengeId}`,
          token: base64UrlEncode(randomBytes(32)),
        };
      });
      const authz: Authorization = {
        id: authzId,
        accountId: account.id,
        orderId,
        identifier: id,
        status: 'pending',
        expires: new Date(
          this.s.clock.nowUnix() * 1000 + this.s.config.authorizationLifetimeSeconds * 1000,
        ).toISOString(),
        challenges,
        wildcard: id.value.startsWith('*.'),
      };
      await this.s.authorizations.save(authz);
      authorizations.push(authz);
    }

    const order: AcmeOrder = {
      id: orderId,
      accountId: account.id,
      status: 'pending',
      expires: new Date(
        this.s.clock.nowUnix() * 1000 + this.s.config.orderLifetimeSeconds * 1000,
      ).toISOString(),
      identifiers: input.identifiers,
      ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
      ...(input.notAfter !== undefined ? { notAfter: input.notAfter } : {}),
      authorizationIds: authorizations.map((a) => a.id),
      finalizeUrl: `${this.s.config.directoryBaseUrl}/acme/finalize/${orderId}`,
    };
    await this.s.orders.save(order);
    return ok(order);
  }
}

export type RespondChallengeError =
  | { type: 'unknown-challenge' }
  | { type: 'challenge-already-finalised' }
  | { type: 'verification-failed' }
  | { type: 'unknown-account' };

export class RespondToChallengeUseCase {
  constructor(private readonly s: AcmeServices) {}

  async execute(input: {
    accountId: string;
    authorizationId: string;
    challengeId: string;
  }): Promise<Result<Challenge, RespondChallengeError>> {
    const account = await this.s.accounts.find(input.accountId);
    if (!account) return err({ type: 'unknown-account' });
    const authz = await this.s.authorizations.find(input.authorizationId);
    if (!authz || authz.accountId !== input.accountId) return err({ type: 'unknown-challenge' });
    const challenge = authz.challenges.find((c) => c.id === input.challengeId);
    if (!challenge) return err({ type: 'unknown-challenge' });
    if (challenge.status === 'valid' || challenge.status === 'invalid') {
      return err({ type: 'challenge-already-finalised' });
    }

    const keyAuth = await keyAuthorization(account.publicJwk, challenge.token);
    let success = false;
    try {
      if (challenge.type === 'http-01') {
        success = await this.s.http01.verify(authz.identifier.value, challenge.token, keyAuth);
      } else if (challenge.type === 'dns-01') {
        const expectedDigest = await sha256B64Url(keyAuth);
        success = await this.s.dns01.verify(authz.identifier.value, expectedDigest);
      } else if (challenge.type === 'tls-alpn-01') {
        success = await this.s.tlsAlpn01.verify(authz.identifier.value, keyAuth);
      }
    } catch {
      success = false;
    }

    const now = this.s.clock.nowIso();
    const updatedChallenge: Challenge = success
      ? { ...challenge, status: 'valid', validated: now }
      : {
          ...challenge,
          status: 'invalid',
          error: {
            type: 'urn:ietf:params:acme:error:incorrectResponse',
            detail: 'challenge verification failed',
            status: 403,
          },
        };

    const updatedAuthz: Authorization = {
      ...authz,
      status: success ? 'valid' : 'invalid',
      challenges: authz.challenges.map((c) => (c.id === challenge.id ? updatedChallenge : c)),
    };
    await this.s.authorizations.save(updatedAuthz);

    // If all authorizations for the order are now valid, transition the order to 'ready'.
    if (success) {
      const order = await this.s.orders.find(authz.orderId);
      if (order) {
        let allValid = true;
        for (const aId of order.authorizationIds) {
          const a = await this.s.authorizations.find(aId);
          if (!a || a.status !== 'valid') {
            allValid = false;
            break;
          }
        }
        if (allValid) {
          await this.s.orders.save({ ...order, status: 'ready' });
        }
      }
    } else {
      const order = await this.s.orders.find(authz.orderId);
      if (order) {
        await this.s.orders.save({ ...order, status: 'invalid' });
      }
    }
    if (!success) return err({ type: 'verification-failed' });
    return ok(updatedChallenge);
  }
}

export type FinalizeOrderError =
  | { type: 'unknown-order' }
  | { type: 'wrong-account' }
  | { type: 'order-not-ready'; status: string }
  | { type: 'bad-csr' }
  | { type: 'csr-name-mismatch' }
  | { type: 'csr-signature-bad' };

export class FinalizeOrderUseCase {
  constructor(private readonly s: AcmeServices) {}

  async execute(input: {
    accountId: string;
    orderId: string;
    csrDer: Uint8Array;
  }): Promise<Result<AcmeOrder, FinalizeOrderError>> {
    const order = await this.s.orders.find(input.orderId);
    if (!order) return err({ type: 'unknown-order' });
    if (order.accountId !== input.accountId) return err({ type: 'wrong-account' });
    if (order.status !== 'ready') return err({ type: 'order-not-ready', status: order.status });

    const csrResult = parseCsr(input.csrDer);
    if (!csrResult.ok) return err({ type: 'bad-csr' });
    const csr = csrResult.value;

    const sigOk = await verifyCsrSignature(csr);
    if (!sigOk) return err({ type: 'csr-signature-bad' });

    const requested = new Set(order.identifiers.map((i) => i.value));
    for (const d of csr.sanDnsNames) {
      if (!requested.has(d)) return err({ type: 'csr-name-mismatch' });
    }
    for (const v of requested) {
      if (!csr.sanDnsNames.includes(v)) return err({ type: 'csr-name-mismatch' });
    }

    await this.s.orders.save({ ...order, status: 'processing' });

    const serialBytes = new Uint8Array(20);
    crypto.getRandomValues(serialBytes);
    serialBytes[0] = serialBytes[0]! & 0x7f; // keep positive
    const serial = bytesToBigInt(serialBytes);
    const nowMs = this.s.clock.nowUnix() * 1000;
    const notBefore = order.notBefore ? new Date(order.notBefore) : new Date(nowMs - 60_000);
    const notAfter = order.notAfter
      ? new Date(order.notAfter)
      : new Date(nowMs + this.s.config.certificateLifetimeSeconds * 1000);

    const commonName = csr.subject.get(OID.commonName) ?? csr.sanDnsNames[0] ?? '';
    const organization = csr.subject.get(OID.organizationName);
    const organizationalUnit = csr.subject.get(OID.organizationalUnit);
    const country = csr.subject.get(OID.country);
    const organizationIdentifier = csr.subject.get(OID.organizationIdentifier);

    const profile: CertProfile = {
      serial,
      subject: {
        commonName,
        ...(organization !== undefined ? { organization } : {}),
        ...(organizationalUnit !== undefined ? { organizationalUnit } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(organizationIdentifier !== undefined ? { organizationIdentifier } : {}),
      },
      issuer: this.s.config.caIssuerDn,
      notBefore,
      notAfter,
      subjectPublicKeyJwk: csr.publicKeyJwk,
      issuerPublicKeyJwk: this.s.config.caPublicJwk,
      isCa: false,
      keyUsage: { digitalSignature: true, keyEncipherment: true },
      extendedKeyUsages: [OID.ekuClientAuth, OID.ekuServerAuth],
      sanDns: csr.sanDnsNames,
      sanUris: csr.sanUris,
      crlDistributionUrl: this.s.config.crlDistributionUrl,
      ocspUrl: this.s.config.ocspUrl,
      caIssuersUrl: this.s.config.caIssuersUrl,
    };
    const tbs = buildTbsCertificate(profile, this.s.signer.algorithmOid);
    const signature = await this.s.signer.sign(tbs);
    const der = attachSignature(tbs, this.s.signer.algorithmOid, signature);
    const pem = toPem(der, 'CERTIFICATE');
    const serialHex = serial.toString(16);

    await this.s.certificates.save({
      serial: serialHex,
      accountId: input.accountId,
      orderId: order.id,
      pem,
      notAfter: notAfter.toISOString(),
    });

    const finalized: AcmeOrder = {
      ...order,
      status: 'valid',
      certificateSerial: serialHex,
    };
    await this.s.orders.save(finalized);
    return ok(finalized);
  }
}

export type RevokeCertificateError =
  | { type: 'unknown-certificate' }
  | { type: 'not-owner' };

export class RevokeCertificateUseCase {
  constructor(private readonly s: AcmeServices) {}

  async execute(input: {
    accountId: string;
    serial: string;
    reason?: string;
  }): Promise<Result<void, RevokeCertificateError>> {
    const cert = await this.s.certificates.find(input.serial);
    if (!cert) return err({ type: 'unknown-certificate' });
    if (cert.accountId !== input.accountId) return err({ type: 'not-owner' });
    await this.s.certificates.save({
      ...cert,
      revokedAt: this.s.clock.nowIso(),
      ...(input.reason !== undefined ? { revocationReason: input.reason } : {}),
    });
    return ok(undefined);
  }
}

export async function keyAuthorization(jwk: Jwk, token: string): Promise<string> {
  const thumb = await jwkThumbprint(jwk);
  return `${token}.${thumb}`;
}

export async function sha256B64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBuffer(new TextEncoder().encode(input)));
  return base64UrlEncode(new Uint8Array(digest));
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export { fromPem, toPem };
export type { IssuedCertificate };
