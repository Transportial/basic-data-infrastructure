// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { ok, type AssociationId, type Result } from '@bdi/kernel';
import type { Trustlist, TrustlistEntry } from '@bdi/contracts';
import type {
  ClockPort,
  ConnectorRepository,
  SignerPort,
} from '../ports.ts';

export interface BuildTrustlistConfig {
  readonly issuer: string;
}

export class BuildTrustlistUseCase {
  private version = 0;

  constructor(
    private readonly connectors: ConnectorRepository,
    private readonly signer: SignerPort,
    private readonly clock: ClockPort,
    private readonly config: BuildTrustlistConfig,
  ) {}

  async execute(
    associationId: AssociationId,
  ): Promise<Result<{ version: number; jws: string; list: Trustlist }, never>> {
    this.version += 1;
    const active = await this.connectors.listActive(associationId);
    const entries: TrustlistEntry[] = active.map(({ member, connector }) => ({
      kid: connector.kid,
      'x5t#S256': connector.cert_thumbprint,
      euid: member.euid,
      assurance: member.assurance_level ?? 'substantial',
      connector_id: connector.id,
      jwk: connector.jwk as Record<string, unknown>,
      not_after: connector.cert_not_after,
    }));

    const list: Trustlist = {
      iss: this.config.issuer,
      aud: `urn:bdi:association:${associationId}`,
      iat: this.clock.nowUnix(),
      version: this.version,
      entries,
    };
    const jws = await this.signer.signJwt(list);
    return ok({ version: this.version, jws, list });
  }
}
