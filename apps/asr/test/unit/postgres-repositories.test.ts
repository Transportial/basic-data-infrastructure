// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { makeConnectorId, parseAssociationId, parseEuid } from '@bdi/kernel';
import {
  InMemorySqlPort,
  PostgresApprovalRepository,
  PostgresConnectorRepository,
  PostgresMemberRepository,
  POSTGRES_SCHEMA,
} from '../../src/infrastructure/repositories/postgres.ts';
import { createDraftMember } from '../../src/domain/model/member.ts';
import type { Connector } from '../../src/domain/model/connector.ts';
import type { FourEyesApproval } from '../../src/domain/model/four-eyes.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const euid = parseEuid('NL.NHR.12345678');
const otherEuid = parseEuid('NL.NHR.99999999');
if (!euid.ok || !otherEuid.ok) throw new Error('setup');
const conId = makeConnectorId('9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

function draft(id: string, e = euid.value) {
  return createDraftMember({
    id,
    association_id: assoc.value,
    euid: e,
    legal_name: `m-${id}`,
    signing_representative: null,
    created_at: '2026-04-23T00:00:00Z',
  });
}

describe('POSTGRES_SCHEMA', () => {
  test('contains expected table definitions', () => {
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS members');
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS connectors');
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS four_eyes_approvals');
    expect(POSTGRES_SCHEMA).toContain('ON DELETE CASCADE');
  });
});

describe('PostgresMemberRepository', () => {
  test('upsert round-trip', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresMemberRepository(sql);
    const m = draft('m-1');
    await repo.save(m);
    const loaded = await repo.find('m-1');
    expect(loaded?.id).toBe('m-1');
    await repo.save({ ...m, status: 'verified' });
    expect((await repo.find('m-1'))?.status).toBe('verified');
  });

  test('findByEuid + listByAssociation + listActive', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresMemberRepository(sql);
    await repo.save(draft('m-1'));
    await repo.save({ ...draft('m-2', otherEuid.value), status: 'activated' });
    expect((await repo.findByEuid(euid.value))?.id).toBe('m-1');
    expect(await repo.findByEuid('NL.NHR.00000000' as unknown as typeof euid.value)).toBeNull();
    expect(await repo.listByAssociation(assoc.value)).toHaveLength(2);
    expect((await repo.listActive(assoc.value)).map((m) => m.id)).toEqual(['m-2']);
  });

  test('missing id returns null', async () => {
    const repo = new PostgresMemberRepository(new InMemorySqlPort());
    expect(await repo.find('missing')).toBeNull();
  });
});

describe('PostgresConnectorRepository', () => {
  test('upsert + listActive join', async () => {
    const sql = new InMemorySqlPort();
    const members = new PostgresMemberRepository(sql);
    await members.save({ ...draft('m-1'), status: 'activated' });
    const connectors = new PostgresConnectorRepository(sql, members);
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
    expect(await connectors.listByMember('m-1')).toHaveLength(1);
    const active = await connectors.listActive(assoc.value);
    expect(active).toHaveLength(1);
  });

  test('find + findByClientId missing returns null', async () => {
    const sql = new InMemorySqlPort();
    const members = new PostgresMemberRepository(sql);
    const connectors = new PostgresConnectorRepository(sql, members);
    expect(await connectors.find('x')).toBeNull();
    expect(await connectors.findByClientId('y')).toBeNull();
  });

  test('listActive returns empty when member not activated', async () => {
    const sql = new InMemorySqlPort();
    const members = new PostgresMemberRepository(sql);
    await members.save(draft('m-1'));
    const connectors = new PostgresConnectorRepository(sql, members);
    const c: Connector = {
      id: conId.value,
      member_id: 'm-1',
      client_id: 'c',
      kid: 'k',
      jwk: {},
      cert_thumbprint: 'tp',
      cert_not_after: 0,
      callback_urls: [],
      status: 'active',
      bound_on: 0,
      authorised_by: 'r',
      created_at: 'now',
    };
    await connectors.save(c);
    expect(await connectors.listActive(assoc.value)).toHaveLength(0);
  });
});

describe('PostgresApprovalRepository', () => {
  test('save + find + findBySubject', async () => {
    const sql = new InMemorySqlPort();
    const repo = new PostgresApprovalRepository(sql);
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
    expect((await repo.find('a-1'))?.first_approval?.by).toBe('alice');
    expect((await repo.findBySubject('member_activation', 'm-1'))?.id).toBe('a-1');
    expect(await repo.findBySubject('member_activation', 'other')).toBeNull();
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

describe('InMemorySqlPort', () => {
  test('unsupported SQL throws', async () => {
    const sql = new InMemorySqlPort();
    await expect(sql.query('SELECT * FROM nowhere')).rejects.toThrow();
  });

  test('exec returns rowCount', async () => {
    const sql = new InMemorySqlPort();
    const r = await sql.exec(
      `INSERT INTO members (id, association_id, euid, legal_name, vat_number, lei, status, assurance_level, verifications, signing_representative, votes_in_association, created_at, activated_at, suspended_at, revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)`,
      [
        'id-1',
        'ctn',
        'NL.NHR.12345678',
        'Acme',
        null,
        null,
        'draft',
        null,
        '[]',
        null,
        false,
        '2026-04-23T00:00:00Z',
        null,
        null,
        null,
      ],
    );
    expect(r.rowCount).toBe(0); // INSERT returns no rows
  });

  test('tx runs autocommit in the in-memory port', async () => {
    const sql = new InMemorySqlPort();
    const out = await sql.tx(async (s) => {
      expect(s).toBe(sql);
      return 42;
    });
    expect(out).toBe(42);
  });
});
