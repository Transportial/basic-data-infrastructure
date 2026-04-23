// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type ConnectorId, type Result } from '@bdi/kernel';

export type ConnectorStatus = 'pending' | 'active' | 'suspended' | 'revoked';

export interface Connector {
  readonly id: ConnectorId;
  readonly member_id: string;
  readonly client_id: string;
  readonly kid: string;
  readonly jwk: Readonly<Record<string, unknown>>;
  readonly cert_thumbprint: string;
  readonly cert_not_after: number;
  readonly callback_urls: ReadonlyArray<string>;
  readonly status: ConnectorStatus;
  readonly bound_on: number;
  readonly authorised_by: string;
  readonly created_at: string;
}

export type ConnectorTransitionError =
  | { type: 'invalid-transition'; from: ConnectorStatus; to: ConnectorStatus }
  | { type: 'bad-callback-url'; url: string };

export function activateConnector(
  connector: Connector,
): Result<Connector, ConnectorTransitionError> {
  if (connector.status !== 'pending' && connector.status !== 'suspended') {
    return err({ type: 'invalid-transition', from: connector.status, to: 'active' });
  }
  return ok({ ...connector, status: 'active' });
}

export function suspendConnector(
  connector: Connector,
): Result<Connector, ConnectorTransitionError> {
  if (connector.status !== 'active') {
    return err({ type: 'invalid-transition', from: connector.status, to: 'suspended' });
  }
  return ok({ ...connector, status: 'suspended' });
}

export function revokeConnector(connector: Connector): Result<Connector, ConnectorTransitionError> {
  if (connector.status === 'revoked') {
    return err({ type: 'invalid-transition', from: connector.status, to: 'revoked' });
  }
  return ok({ ...connector, status: 'revoked' });
}

export function validateCallbackUrls(
  urls: ReadonlyArray<string>,
): Result<ReadonlyArray<string>, ConnectorTransitionError> {
  for (const u of urls) {
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        return err({ type: 'bad-callback-url', url: u });
      }
    } catch {
      return err({ type: 'bad-callback-url', url: u });
    }
  }
  return ok(urls);
}
