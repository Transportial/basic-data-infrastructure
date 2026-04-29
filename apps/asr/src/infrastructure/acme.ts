// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { generateKeyPair, publicJwk, type KeyAlg } from '@transportial/crypto';
import {
  buildAcmeHttp,
  InMemoryAccountRepository,
  InMemoryAuthorizationRepository,
  InMemoryCertificateRepository,
  InMemoryEabStore,
  InMemoryNonceStore,
  InMemoryOrderRepository,
  JwkCaSigner,
  OcspResponder,
  StaticDnsChallengeVerifier,
  StaticHttpChallengeVerifier,
  StaticTlsAlpnChallengeVerifier,
  SystemDnsChallengeVerifier,
  SystemHttpChallengeVerifier,
  sha1Sync,
  type AcmeHttp,
  type AcmeServerConfig,
  type AcmeServices,
  type DnsResolver,
} from '@transportial/crypto-ca';
import { jwkToSpki, spkiPublicKeyBytes } from '@transportial/crypto-ca';

export interface BuildAcmeOptions {
  readonly directoryBaseUrl: string;
  readonly termsOfService?: string;
  readonly website?: string;
  readonly caAlg?: KeyAlg;
  readonly dnsResolver?: DnsResolver;
  readonly useStaticVerifiers?: boolean;
}

export interface AcmeBundle {
  readonly handler: AcmeHttp;
  readonly services: AcmeServices;
  readonly eab: InMemoryEabStore;
  readonly ocsp: OcspResponder;
  readonly staticHttp?: StaticHttpChallengeVerifier;
  readonly staticDns?: StaticDnsChallengeVerifier;
  readonly staticTlsAlpn?: StaticTlsAlpnChallengeVerifier;
}

export async function buildAcmeBundle(options: BuildAcmeOptions): Promise<AcmeBundle> {
  const alg: KeyAlg = options.caAlg ?? 'ES256';
  const caPair = await generateKeyPair(alg);
  const signer = JwkCaSigner.from(caPair.privateJwk, alg);
  const eab = new InMemoryEabStore();

  const staticHttp = options.useStaticVerifiers ? new StaticHttpChallengeVerifier() : undefined;
  const staticDns = options.useStaticVerifiers ? new StaticDnsChallengeVerifier() : undefined;
  const staticTlsAlpn = options.useStaticVerifiers ? new StaticTlsAlpnChallengeVerifier() : undefined;

  const http01 = staticHttp ?? new SystemHttpChallengeVerifier();
  const dns01 = staticDns ?? new SystemDnsChallengeVerifier(
    options.dnsResolver ?? {
      async resolveTxt() {
        return [];
      },
    },
  );
  const tlsAlpn01 = staticTlsAlpn ?? new StaticTlsAlpnChallengeVerifier();

  const config: AcmeServerConfig = {
    directoryBaseUrl: options.directoryBaseUrl,
    ...(options.termsOfService !== undefined ? { termsOfService: options.termsOfService } : {}),
    ...(options.website !== undefined ? { website: options.website } : {}),
    orderLifetimeSeconds: 7 * 86_400,
    authorizationLifetimeSeconds: 7 * 86_400,
    certificateLifetimeSeconds: 90 * 86_400,
    caIssuerDn: {
      commonName: 'BDI Association Root CA',
      organization: 'Transportial',
      country: 'NL',
    },
    caPublicJwk: publicJwk(caPair.publicJwk),
    crlDistributionUrl: `${options.directoryBaseUrl}/acme/crl`,
    ocspUrl: `${options.directoryBaseUrl}/acme/ocsp`,
    caIssuersUrl: `${options.directoryBaseUrl}/acme/ca.crt`,
    challengeTypes: ['http-01', 'dns-01'],
  };

  let counter = 0;
  const services: AcmeServices = {
    accounts: new InMemoryAccountRepository(),
    orders: new InMemoryOrderRepository(),
    authorizations: new InMemoryAuthorizationRepository(),
    certificates: new InMemoryCertificateRepository(),
    nonces: new InMemoryNonceStore(),
    eab,
    http01,
    dns01,
    tlsAlpn01,
    signer,
    clock: {
      nowIso: () => new Date().toISOString(),
      nowUnix: () => Math.floor(Date.now() / 1000),
    },
    ids: { newId: (prefix) => `${prefix}-${++counter}` },
    config,
  };

  const handler = buildAcmeHttp(services);
  const caPublicBits = spkiPublicKeyBytes(jwkToSpki(config.caPublicJwk));
  const responderKeyHash = sha1Sync(caPublicBits);
  const ocsp = new OcspResponder(services.certificates, signer, responderKeyHash);
  return {
    handler,
    services,
    eab,
    ocsp,
    ...(staticHttp !== undefined ? { staticHttp } : {}),
    ...(staticDns !== undefined ? { staticDns } : {}),
    ...(staticTlsAlpn !== undefined ? { staticTlsAlpn } : {}),
  };
}
