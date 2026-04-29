// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  err,
  ok,
  makeConnectorId,
  validatePublicJwk,
  type Jwk,
  type Result,
} from '@transportial/kernel';
import { validateCallbackUrls } from '../../domain/model/connector.ts';
import type { Connector } from '../../domain/model/connector.ts';
import type {
  ClockPort,
  ConnectorRepository,
  EventBusPort,
  IdPort,
  MemberRepository,
} from '../ports.ts';

export type RegisterConnectorError =
  | { type: 'member-not-found'; id: string }
  | { type: 'member-not-active' }
  | { type: 'bad-jwk' }
  | { type: 'bad-callback-url'; url: string }
  | { type: 'bad-connector-id' }
  | { type: 'client-id-taken'; clientId: string };

export interface RegisterConnectorInput {
  readonly memberId: string;
  readonly clientId: string;
  readonly jwk: Jwk;
  readonly kid: string;
  readonly certThumbprint: string;
  readonly certNotAfter: number;
  readonly callbackUrls: ReadonlyArray<string>;
  readonly authorisedBy: string;
}

export class RegisterConnectorUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly connectors: ConnectorRepository,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: RegisterConnectorInput,
  ): Promise<Result<{ connectorId: string }, RegisterConnectorError>> {
    const member = await this.members.find(input.memberId);
    if (!member) return err({ type: 'member-not-found', id: input.memberId });
    if (member.status !== 'activated') return err({ type: 'member-not-active' });

    const jwk = validatePublicJwk(input.jwk);
    if (!jwk.ok) return err({ type: 'bad-jwk' });

    const urls = validateCallbackUrls(input.callbackUrls);
    if (!urls.ok) {
      const u = urls.error.type === 'bad-callback-url' ? urls.error.url : '';
      return err({ type: 'bad-callback-url', url: u });
    }

    const clash = await this.connectors.findByClientId(input.clientId);
    if (clash) return err({ type: 'client-id-taken', clientId: input.clientId });

    const id = makeConnectorId(this.ids.newUuid());
    if (!id.ok) return err({ type: 'bad-connector-id' });

    const now = this.clock.nowUnix();
    const connector: Connector = {
      id: id.value,
      member_id: member.id,
      client_id: input.clientId,
      kid: input.kid,
      jwk: jwk.value as unknown as Record<string, unknown>,
      cert_thumbprint: input.certThumbprint,
      cert_not_after: input.certNotAfter,
      callback_urls: urls.value,
      status: 'pending',
      bound_on: now,
      authorised_by: input.authorisedBy,
      created_at: this.clock.nowIso(),
    };
    await this.connectors.save(connector);
    await this.bus.publish('asr.connector.registered', member.association_id, {
      connector_id: connector.id,
      member_id: member.id,
    });
    return ok({ connectorId: connector.id });
  }
}
