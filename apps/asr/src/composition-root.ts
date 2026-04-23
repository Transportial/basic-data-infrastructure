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
  InMemoryApprovalRepository,
  InMemoryConnectorRepository,
  InMemoryMemberRepository,
} from './infrastructure/repositories/in-memory.ts';
import { JwsSigner, randomSigningKey } from './infrastructure/crypto/signer.ts';
import {
  KvkVerificationSource,
  ViesVerificationSource,
} from './infrastructure/verification-sources.ts';
import { SystemUuidIds } from './infrastructure/id-port.ts';
import { buildRouter } from './interface/http/routes.ts';
import type { Router } from './interface/http/router.ts';
import type { EventBusPort, VerificationSource } from './application/ports.ts';

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
  readonly signingKid?: string;
  readonly signingKey?: Uint8Array;
  readonly verificationSources?: ReadonlyArray<VerificationSource>;
  readonly kvk?: { baseUrl: string; apiKey: string };
  readonly vies?: { baseUrl: string };
}

export interface AsrComposition {
  readonly router: Router;
  readonly deps: {
    readonly members: InMemoryMemberRepository;
    readonly connectors: InMemoryConnectorRepository;
    readonly approvals: InMemoryApprovalRepository;
    readonly signer: JwsSigner;
    readonly bus: InMemoryEventBus;
  };
}

export function composeAsr(config: AsrConfig): AsrComposition {
  const clock = new SystemClock();
  const ids = new SystemUuidIds();
  const bus = new InMemoryEventBus();
  const signer = new JwsSigner({
    kid: config.signingKid ?? 'asr-2026-01',
    key: config.signingKey ?? randomSigningKey(),
  });

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
  const issueBvad = new IssueBvadUseCase(members, connectors, signer, clock, ids, bus, {
    issuer: config.issuer,
  });
  const buildTrustlist = new BuildTrustlistUseCase(connectors, signer, clock, {
    issuer: config.issuer,
  });

  const router = buildRouter({
    startOnboarding,
    runVerifications,
    activateMember,
    changeStatus,
    registerConnector,
    issueBvad,
    buildTrustlist,
    members,
  });

  return { router, deps: { members, connectors, approvals, signer, bus } };
}
