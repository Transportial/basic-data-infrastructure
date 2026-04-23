// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Result } from '@bdi/kernel';
import type { BvadClaims, BvodClaims } from '@bdi/contracts';
import {
  validateBvadTiming,
  validateBvodTiming,
  type ValidationError,
} from '../../domain/token-verification.ts';
import type { PdpInput, PolicyDecisionPoint } from '@bdi/policy';
import type {
  ClockPort,
  OrsTrustPort,
  TrustlistPort,
} from '../ports.ts';

export type VerifyIncomingError =
  | { type: 'bvad-missing' }
  | { type: 'bvad-invalid' }
  | { type: 'bvad-rejected'; reason: ValidationError['type'] }
  | { type: 'bvod-missing' }
  | { type: 'bvod-invalid' }
  | { type: 'bvod-rejected'; reason: ValidationError['type'] }
  | { type: 'policy-denied'; reason: string };

export interface VerifyIncomingInput {
  readonly bvad: string | null;
  readonly bvod: string | null;
  readonly action: string;
  readonly resource: { type: string; id: string; tags?: Record<string, string> };
}

export interface VerifyIncomingOutput {
  readonly bvad: BvadClaims;
  readonly bvod: BvodClaims;
}

export interface VerifyIncomingConfig {
  readonly asrIssuer: string;
  readonly orsIssuer: string;
  readonly ownConnectorId: string;
  readonly associationId: string;
  readonly audience: string;
}

export class VerifyIncomingUseCase {
  constructor(
    private readonly trustlist: TrustlistPort,
    private readonly orsTrust: OrsTrustPort,
    private readonly pdp: PolicyDecisionPoint,
    private readonly clock: ClockPort,
    private readonly config: VerifyIncomingConfig,
  ) {}

  async execute(
    input: VerifyIncomingInput,
  ): Promise<Result<VerifyIncomingOutput, VerifyIncomingError>> {
    if (!input.bvad) return err({ type: 'bvad-missing' });
    if (!input.bvod) return err({ type: 'bvod-missing' });

    const bvad = await this.trustlist.verifyBvad(input.bvad);
    if (!bvad) return err({ type: 'bvad-invalid' });

    const bvadCheck = validateBvadTiming(bvad, {
      now: this.clock.nowUnix(),
      expectedIssuer: this.config.asrIssuer,
      expectedAudience: this.config.audience,
      expectedAssociation: this.config.associationId,
    });
    if (!bvadCheck.ok) return err({ type: 'bvad-rejected', reason: bvadCheck.error.type });

    const bvod = await this.orsTrust.verifyBvod(input.bvod);
    if (!bvod) return err({ type: 'bvod-invalid' });

    const bvodCheck = validateBvodTiming(bvod, {
      now: this.clock.nowUnix(),
      expectedIssuer: this.config.orsIssuer,
      expectedAudience: this.config.ownConnectorId,
      subjectConnectorId: bvad.sub,
    });
    if (!bvodCheck.ok) return err({ type: 'bvod-rejected', reason: bvodCheck.error.type });

    const pdpInput: PdpInput = {
      subject: {
        connector_id: bvad.sub,
        organisation_euid: bvad['https://bdi.nl/claims/organisation'].euid,
        assurance: bvad['https://bdi.nl/claims/assurance'].level,
        status: 'active',
      },
      context: {
        chain_context_id: bvod['https://bdi.nl/claims/chain_context'].id,
        roles: bvod['https://bdi.nl/claims/involvement'].roles,
        ...(bvod['https://bdi.nl/claims/involvement'].delegated_from !== undefined
          ? { delegated_by: bvod['https://bdi.nl/claims/involvement'].delegated_from }
          : {}),
      },
      action: input.action,
      resource: input.resource,
    };
    const decision = await this.pdp.decide(pdpInput);
    if (decision.effect === 'deny') {
      return err({ type: 'policy-denied', reason: decision.reason });
    }
    return ok({ bvad, bvod });
  }
}
