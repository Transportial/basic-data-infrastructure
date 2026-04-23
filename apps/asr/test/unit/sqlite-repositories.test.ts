// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { makeConnectorId, parseAssociationId, parseEuid } from '@bdi/kernel';
import {
  openSqlite,
  SqliteApprovalRepository,
  SqliteConnectorRepository,
  SqliteMemberRepository,
} from '../../src/infrastructure/repositories/sqlite.ts';
import type { Connector } from '../../src/domain/model/connector.ts';
import type { FourEyesApproval } from '../../src/domain/model/four-eyes.ts';
import { createDraftMember } from '../../src/domain/model/member.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const euid = parseEuid('NL.NHR.12345678');
const euid2 = parseEuid('NL.NHR.99999999');
if (!euid.ok || !euid2.ok) throw new Error('setup');
const conId = makeConnectorId('9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

function drafts() {
  return createDraftMember({
    id: 'm-1',
    association_id: assoc.value,
    euid: euid.value,
    legal_name: 'Acme',
    signing_representative: null,
    created_at: '2026-04-23T00:00:00Z',
  });
}

describe('SqliteMemberRepository', () => {
  test('upsert round-trip', async () => {
    const db = openSqlite();
    const repo = new SqliteMemberRepository(db);
    const m = drafts();
    await repo.save(m);
    const loaded = await repo.find('m-1');
    expect(loaded?.id).toBe('m-1');
    expect(loaded?.status).toBe('draft');
    await repo.save({ ...m, status: 'verified', legal_name: 'Acme 2' });
    const loaded2 = await repo.find('m-1');
    expect(loaded2?.status).toBe('verified');
    expect(loaded2?.legal_name).toBe('Acme 2');
  });

  test('optional fields roundtrip', async () => {
    const db = openSqlite();
    const repo = new SqliteMemberRepository(db);
    const m = {
      ...drafts(),
      vat_number: 'NL123',
      lei: 'HWUPKR0MPOU8FGXBT394',
      signing_representative: {
        subject_id: 's',
        auth_source: 'eHerkenning' as const,
        assurance: 'high' as const,
        verified_at: 'now',
      },
    };
    await repo.save(m);
    const loaded = await repo.find('m-1');
    expect(loaded?.vat_number).toBe('NL123');
    expect(loaded?.lei).toBe('HWUPKR0MPOU8FGXBT394');
    expect(loaded?.signing_representative?.subject_id).toBe('s');
  });

  test('findByEuid', async () => {
    const repo = new SqliteMemberRepository(openSqlite());
    await repo.save(drafts());
    expect((await repo.findByEuid(euid.value))?.id).toBe('m-1');
    expect(await repo.findByEuid(euid2.value)).toBeNull();
  });

  test('listByAssociation and listActive', async () => {
    const db = openSqlite();
    const repo = new SqliteMemberRepository(db);
    await repo.save(drafts());
    await repo.save({ ...drafts(), id: 'm-2', euid: euid2.value, status: 'activated' });
    expect(await repo.listByAssociation(assoc.value)).toHaveLength(2);
    expect(await repo.listActive(assoc.value)).toHaveLength(1);
  });
});

describe('SqliteConnectorRepository', () => {
  test('upsert + findByClientId + listActive join', async () => {
    const db = openSqlite();
    const members = new SqliteMemberRepository(db);
    await members.save({ ...drafts(), status: 'activated' });
    const connectors = new SqliteConnectorRepository(db, members);
    const c: Connector = {
      id: conId.value,
      member_id: 'm-1',
      client_id: 'client-1',
      kid: 'k',
      jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
      cert_thumbprint: 'tp',
      cert_not_after: 0,
      callback_urls: ['https://example.com/hook'],
      status: 'active',
      bound_on: 0,
      authorised_by: 'rep',
      created_at: 'now',
    };
    await connectors.save(c);
    expect((await connectors.findByClientId('client-1'))?.status).toBe('active');
    expect((await connectors.find(c.id))?.client_id).toBe('client-1');
    expect(await connectors.findByClientId('nope')).toBeNull();
    const active = await connectors.listActive(assoc.value);
    expect(active).toHaveLength(1);
    await connectors.save({ ...c, status: 'revoked' });
    expect((await connectors.findByClientId('client-1'))?.status).toBe('revoked');
  });

  test('listByMember filters', async () => {
    const db = openSqlite();
    const members = new SqliteMemberRepository(db);
    await members.save(drafts());
    const connectors = new SqliteConnectorRepository(db, members);
    await connectors.save({
      id: conId.value,
      member_id: 'm-1',
      client_id: 'x',
      kid: 'k',
      jwk: {},
      cert_thumbprint: 't',
      cert_not_after: 0,
      callback_urls: [],
      status: 'pending',
      bound_on: 0,
      authorised_by: 'r',
      created_at: 'now',
    });
    expect(await connectors.listByMember('m-1')).toHaveLength(1);
    expect(await connectors.listByMember('other')).toHaveLength(0);
  });
});

describe('SqliteApprovalRepository', () => {
  test('round-trip with complex approver objects', async () => {
    const db = openSqlite();
    const repo = new SqliteApprovalRepository(db);
    const a: FourEyesApproval = {
      id: 'a-1',
      subject_type: 'member_activation',
      subject_id: 'm-1',
      state: 'first',
      first_approval: { by: 'alice', at: 'now' },
      second_approval: null,
      created_at: 'now',
    };
    await repo.save(a);
    const loaded = await repo.find('a-1');
    expect(loaded?.first_approval?.by).toBe('alice');
    expect(loaded?.second_approval).toBeNull();
    const bySubj = await repo.findBySubject('member_activation', 'm-1');
    expect(bySubj?.id).toBe('a-1');
    expect(await repo.findBySubject('member_activation', 'x')).toBeNull();
    expect(await repo.find('missing')).toBeNull();
  });

  test('update approves second', async () => {
    const db = openSqlite();
    const repo = new SqliteApprovalRepository(db);
    const a: FourEyesApproval = {
      id: 'a-1',
      subject_type: 'member_activation',
      subject_id: 'm-1',
      state: 'first',
      first_approval: { by: 'alice', at: 'now' },
      second_approval: null,
      created_at: 'now',
    };
    await repo.save(a);
    await repo.save({
      ...a,
      state: 'completed',
      second_approval: { by: 'bob', at: 'now' },
    });
    const loaded = await repo.find('a-1');
    expect(loaded?.state).toBe('completed');
    expect(loaded?.second_approval?.by).toBe('bob');
  });
});
