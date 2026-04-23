// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Result } from '../result.ts';
import type { Brand } from '../branded.ts';

export type ConnectorId = Brand<string, 'ConnectorId'>;

export type ConnectorIdParseError =
  | { type: 'empty' }
  | { type: 'bad-scheme' }
  | { type: 'bad-uuid' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseConnectorId(raw: string): Result<ConnectorId, ConnectorIdParseError> {
  if (!raw) return err({ type: 'empty' });
  if (!raw.startsWith('urn:bdi:connector:')) return err({ type: 'bad-scheme' });
  const uuid = raw.slice('urn:bdi:connector:'.length);
  if (!UUID_RE.test(uuid)) return err({ type: 'bad-uuid' });
  return ok(raw as ConnectorId);
}

export function makeConnectorId(uuid: string): Result<ConnectorId, ConnectorIdParseError> {
  return parseConnectorId(`urn:bdi:connector:${uuid}`);
}

export function isConnectorId(x: unknown): x is ConnectorId {
  return typeof x === 'string' && parseConnectorId(x).ok;
}
