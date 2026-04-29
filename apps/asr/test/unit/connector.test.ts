// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { makeConnectorId } from '@transportial/kernel';
import {
  activateConnector,
  revokeConnector,
  suspendConnector,
  validateCallbackUrls,
  type Connector,
} from '../../src/domain/model/connector.ts';

const id = makeConnectorId('9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!id.ok) throw new Error('bad fixture');

const base: Connector = {
  id: id.value,
  member_id: 'm-1',
  client_id: 'c-1',
  kid: 'k',
  jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
  cert_thumbprint: 'tp',
  cert_not_after: 0,
  callback_urls: [],
  status: 'pending',
  bound_on: 0,
  authorised_by: 'rep',
  created_at: 'now',
};

describe('validateCallbackUrls', () => {
  test('accepts https', () => {
    expect(validateCallbackUrls(['https://example.com/webhook']).ok).toBe(true);
  });

  test('accepts localhost http for dev', () => {
    expect(validateCallbackUrls(['http://localhost:3000/hook']).ok).toBe(true);
    expect(validateCallbackUrls(['http://127.0.0.1:3000/hook']).ok).toBe(true);
  });

  test('rejects plain http for non-local', () => {
    const r = validateCallbackUrls(['http://example.com/']);
    expect(!r.ok && r.error.type).toBe('bad-callback-url');
  });

  test('rejects garbage URL', () => {
    const r = validateCallbackUrls(['not a url']);
    expect(!r.ok).toBe(true);
  });

  test('empty list is OK', () => {
    expect(validateCallbackUrls([]).ok).toBe(true);
  });
});

describe('connector transitions', () => {
  test('activate from pending', () => {
    const r = activateConnector(base);
    expect(r.ok && r.value.status).toBe('active');
  });

  test('activate from suspended', () => {
    const r = activateConnector({ ...base, status: 'suspended' });
    expect(r.ok && r.value.status).toBe('active');
  });

  test('activate from active fails', () => {
    const r = activateConnector({ ...base, status: 'active' });
    expect(!r.ok).toBe(true);
  });

  test('suspend active', () => {
    const r = suspendConnector({ ...base, status: 'active' });
    expect(r.ok && r.value.status).toBe('suspended');
  });

  test('suspend pending fails', () => {
    const r = suspendConnector(base);
    expect(!r.ok).toBe(true);
  });

  test('revoke active', () => {
    const r = revokeConnector({ ...base, status: 'active' });
    expect(r.ok && r.value.status).toBe('revoked');
  });

  test('revoke already-revoked fails', () => {
    const r = revokeConnector({ ...base, status: 'revoked' });
    expect(!r.ok).toBe(true);
  });
});
