// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { SystemClock } from '@bdi/kernel';
import { StartOnboardingUseCase } from './application/use-cases/start-onboarding.ts';
import { RunVerificationsUseCase } from './application/use-cases/run-verifications.ts';
import { ActivateMemberUseCase } from './application/use-cases/activate-member.ts';
import { ChangeMemberStatusUseCase } from './application/use-cases/change-member-status.ts';
import { RegisterConnectorUseCase } from './application/use-cases/register-connector.ts';
import { IssueBvadUseCase } from './application/use-cases/issue-bvad.ts';
import { BuildTrustlistUseCase } from './application/use-cases/build-trustlist.ts';
import {
  AuthenticateClientUseCase,
  InMemoryJtiCache,
  type SeenJtiCache,
} from './application/use-cases/authenticate-client.ts';
import {
  InMemoryKeystore,
  InMemoryJwksService,
  type JwksService,
  type Keystore,
} from './application/use-cases/jwks.ts';
import {
  TokenExchangeUseCase,
  InMemoryFederationRegistry,
  type FederationRegistry,
} from './application/use-cases/token-exchange.ts';
import {
  InMemoryTokensJournal,
  type IssuedTokensJournal,
} from './application/use-cases/issued-tokens-journal.ts';
import {
  InMemoryApprovalRepository,
  InMemoryConnectorRepository,
  InMemoryMemberRepository,
} from './infrastructure/repositories/in-memory.ts';
import { JwsSigner } from './infrastructure/crypto/signer.ts';
import {
  KvkVerificationSource,
  ViesVerificationSource,
} from './infrastructure/verification-sources.ts';
import { SystemUuidIds } from './infrastructure/id-port.ts';
import { buildRouter } from './interface/http/routes.ts';
import type { Router } from './interface/http/router.ts';
import type { EventBusPort, VerificationSource } from './application/ports.ts';
import { buildAcmeBundle, type AcmeBundle, type BuildAcmeOptions } from './infrastructure/acme.ts';

export class InMemoryEventBus implements EventBusPort {
  readonly published: Array<{ type: string; associationId: string; body: unknown }> = [];
  async publish(type: string, associationId: string, body: unknown): Promise<void> {
    this.published.push({ type, associationId, body });
  }
  clear(): void {
    this.published.length = 0;
  }
}

export interface AsrConfig {
  readonly issuer: string;
  readonly tokenEndpointUrl?: string;
  readonly signer?: JwsSigner;
  readonly verificationSources?: ReadonlyArray<VerificationSource>;
  readonly kvk?: { baseUrl: string; apiKey: string };
  readonly vies?: { baseUrl: string };
  readonly federation?: FederationRegistry;
  readonly jtiCache?: SeenJtiCache;
  readonly keystore?: Keystore;
  readonly journal?: IssuedTokensJournal;
  readonly acme?: Omit<BuildAcmeOptions, 'directoryBaseUrl'> & { directoryBaseUrl?: string };
}

export interface AsrComposition {
  readonly router: Router;
  readonly acme: AcmeBundle;
  readonly deps: {
    readonly members: InMemoryMemberRepository;
    readonly connectors: InMemoryConnectorRepository;
    readonly approvals: InMemoryApprovalRepository;
    readonly signer: JwsSigner;
    readonly bus: InMemoryEventBus;
    readonly jtiCache: SeenJtiCache;
    readonly journal: IssuedTokensJournal;
    readonly keystore: Keystore;
    readonly federation: FederationRegistry;
    readonly jwks: JwksService;
  };
}

export async function composeAsr(config: AsrConfig): Promise<AsrComposition> {
  const clock = new SystemClock();
  const ids = new SystemUuidIds();
  const bus = new InMemoryEventBus();
  const signer = config.signer ?? (await JwsSigner.generate('ES256'));
  const keystore =
    config.keystore ??
    new InMemoryKeystore({
      kid: signer.kid,
      alg: 'ES256',
      publicJwk: signer.publicJwk,
      status: 'active',
      issuedAt: clock.nowIso(),
    });
  const jwks = new InMemoryJwksService(keystore);
  const jtiCache = config.jtiCache ?? new InMemoryJtiCache();
  const journal = config.journal ?? new InMemoryTokensJournal();
  const federation = config.federation ?? new InMemoryFederationRegistry();

  const members = new InMemoryMemberRepository();
  const connectors = new InMemoryConnectorRepository(members);
  const approvals = new InMemoryApprovalRepository();

  const sources: ReadonlyArray<VerificationSource> =
    config.verificationSources ??
    [
      ...(config.kvk ? [new KvkVerificationSource(config.kvk)] : []),
      ...(config.vies ? [new ViesVerificationSource(config.vies)] : []),
    ];

  const startOnboarding = new StartOnboardingUseCase(members, ids, clock, bus);
  const runVerifications = new RunVerificationsUseCase(members, sources, clock, bus);
  const activateMember = new ActivateMemberUseCase(members, approvals, ids, clock, bus);
  const changeStatus = new ChangeMemberStatusUseCase(members, clock, bus);
  const registerConnector = new RegisterConnectorUseCase(members, connectors, ids, clock, bus);
  const issueBvad = new IssueBvadUseCase(members, connectors, signer, clock, ids, bus, journal, {
    issuer: config.issuer,
  });
  const buildTrustlist = new BuildTrustlistUseCase(connectors, signer, clock, {
    issuer: config.issuer,
  });
  const authenticateClient = new AuthenticateClientUseCase(connectors, clock, jtiCache);
  const tokenExchange = new TokenExchangeUseCase(federation, signer, clock, ids, bus, {
    issuer: config.issuer,
  });

  const tokenEndpointUrl = config.tokenEndpointUrl ?? `${config.issuer}/oauth2/token`;

  const acme = await buildAcmeBundle({
    directoryBaseUrl: config.acme?.directoryBaseUrl ?? config.issuer,
    ...(config.acme?.termsOfService !== undefined ? { termsOfService: config.acme.termsOfService } : {}),
    ...(config.acme?.website !== undefined ? { website: config.acme.website } : {}),
    ...(config.acme?.caAlg !== undefined ? { caAlg: config.acme.caAlg } : {}),
    ...(config.acme?.dnsResolver !== undefined ? { dnsResolver: config.acme.dnsResolver } : {}),
    ...(config.acme?.useStaticVerifiers !== undefined ? { useStaticVerifiers: config.acme.useStaticVerifiers } : {}),
  });

  const router = buildRouter({
    startOnboarding,
    runVerifications,
    activateMember,
    changeStatus,
    registerConnector,
    issueBvad,
    buildTrustlist,
    authenticateClient,
    tokenExchange,
    jwks,
    members,
    tokenEndpointUrl,
  });

  return {
    router,
    acme,
    deps: { members, connectors, approvals, signer, bus, jtiCache, journal, keystore, federation, jwks },
  };
}
