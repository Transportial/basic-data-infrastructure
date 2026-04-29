// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import type { BvadClaims, BvodClaims } from '@transportial/contracts';
import { verifyX5cChain, computeCertThumbprintSha256 } from '@transportial/crypto';
import {
  validateBvadTiming,
  validateBvodTiming,
  type ValidationError,
} from '../../domain/token-verification.ts';
import type { PdpInput, PolicyDecisionPoint } from '@transportial/policy';
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
  | { type: 'x5c-chain-invalid'; reason: string }
  | { type: 'x5c-thumbprint-mismatch' }
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
  readonly trustedCaSpkiHashes?: ReadonlySet<string>;
  readonly requireX5c?: boolean;
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

    // x5c header (optional unless requireX5c=true): validate the supplied chain
    // terminates at a trusted anchor and the leaf's SHA-256 matches the BVAD
    // connector-claim thumbprint.
    const bvadHeader = this.extractHeader(input.bvad);
    const x5c = bvadHeader?.x5c;
    if (this.config.requireX5c && (!x5c || x5c.length === 0)) {
      return err({ type: 'x5c-chain-invalid', reason: 'missing' });
    }
    if (x5c && x5c.length > 0) {
      const trusted = this.config.trustedCaSpkiHashes;
      if (trusted && trusted.size > 0) {
        const chainError = await verifyX5cChain(x5c, { trustedSpkiSha256: trusted });
        if (chainError) return err({ type: 'x5c-chain-invalid', reason: chainError.type });
      }
      const leafThumb = await computeCertThumbprintSha256(x5c[0]!);
      const expected = bvad['https://bdi.nl/claims/connector'].x5t_s256;
      if (leafThumb !== expected) {
        return err({ type: 'x5c-thumbprint-mismatch' });
      }
    }

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

  private extractHeader(compact: string): { x5c?: string[] } | null {
    try {
      const [headerB64] = compact.split('.', 1);
      if (!headerB64) return null;
      const normalised = headerB64.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalised + '==='.slice((normalised.length + 3) % 4);
      const json = JSON.parse(atob(padded)) as { x5c?: string[] };
      return json;
    } catch {
      return null;
    }
  }
}
