// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { parseAssociationId, parseEuid, makeConnectorId } from '@transportial/kernel';
import {
  InMemoryApprovalRepository,
  InMemoryConnectorRepository,
  InMemoryMemberRepository,
} from '../../src/infrastructure/repositories/in-memory.ts';
import { createDraftMember } from '../../src/domain/model/member.ts';
import type { Connector } from '../../src/domain/model/connector.ts';
import type { FourEyesApproval } from '../../src/domain/model/four-eyes.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const euid = parseEuid('NL.NHR.12345678');
if (!euid.ok) throw new Error('setup');
const otherEuid = parseEuid('NL.NHR.99999999');
if (!otherEuid.ok) throw new Error('setup');
const conId = makeConnectorId('9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

function draft(id: string, e = euid.value) {
  return createDraftMember({
    id,
    association_id: assoc.value,
    euid: e,
    legal_name: `m-${id}`,
    signing_representative: null,
    created_at: 'now',
  });
}

describe('InMemoryMemberRepository', () => {
  test('save + find round-trip', async () => {
    const r = new InMemoryMemberRepository();
    const m = draft('m-1');
    await r.save(m);
    expect((await r.find('m-1'))?.id).toBe('m-1');
  });

  test('find unknown → null', async () => {
    const r = new InMemoryMemberRepository();
    expect(await r.find('x')).toBeNull();
  });

  test('findByEuid', async () => {
    const r = new InMemoryMemberRepository();
    await r.save(draft('m-1'));
    expect((await r.findByEuid(euid.value))?.id).toBe('m-1');
    expect(await r.findByEuid(otherEuid.value)).toBeNull();
  });

  test('listByAssociation filters', async () => {
    const r = new InMemoryMemberRepository();
    await r.save(draft('m-1'));
    await r.save(draft('m-2', otherEuid.value));
    expect(await r.listByAssociation(assoc.value)).toHaveLength(2);
  });

  test('listActive filters by status', async () => {
    const r = new InMemoryMemberRepository();
    await r.save(draft('m-1'));
    await r.save({ ...draft('m-2', otherEuid.value), status: 'activated' });
    const active = await r.listActive(assoc.value);
    expect(active.map((m) => m.id)).toEqual(['m-2']);
  });
});

describe('InMemoryConnectorRepository', () => {
  function mkConnector(memberId: string, clientId: string, status: Connector['status'] = 'pending'): Connector {
    return {
      id: conId.value,
      member_id: memberId,
      client_id: clientId,
      kid: 'k',
      jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
      cert_thumbprint: 'tp',
      cert_not_after: 0,
      callback_urls: [],
      status,
      bound_on: 0,
      authorised_by: 'r',
      created_at: 'now',
    };
  }

  test('find & findByClientId', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const c = mkConnector('m-1', 'client-1');
    await connectors.save(c);
    expect((await connectors.find(c.id))?.id).toBe(c.id);
    expect((await connectors.findByClientId('client-1'))?.id).toBe(c.id);
    expect(await connectors.find('missing')).toBeNull();
    expect(await connectors.findByClientId('nope')).toBeNull();
  });

  test('listByMember', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    await connectors.save(mkConnector('m-1', 'c-1'));
    expect(await connectors.listByMember('m-1')).toHaveLength(1);
    expect(await connectors.listByMember('other')).toHaveLength(0);
  });

  test('listActive returns active connectors of activated members', async () => {
    const members = new InMemoryMemberRepository();
    await members.save({ ...draft('m-1'), status: 'activated' });
    const connectors = new InMemoryConnectorRepository(members);
    await connectors.save(mkConnector('m-1', 'c-1', 'active'));
    await connectors.save({ ...mkConnector('m-1', 'c-2', 'active'), id: 'urn:bdi:connector:2' as unknown as typeof conId.value });
    const active = await connectors.listActive(assoc.value);
    expect(active).toHaveLength(2);
  });

  test('listActive skips inactive connector', async () => {
    const members = new InMemoryMemberRepository();
    await members.save({ ...draft('m-1'), status: 'activated' });
    const connectors = new InMemoryConnectorRepository(members);
    await connectors.save(mkConnector('m-1', 'c-1', 'suspended'));
    expect(await connectors.listActive(assoc.value)).toHaveLength(0);
  });

  test('listActive skips non-activated member', async () => {
    const members = new InMemoryMemberRepository();
    await members.save(draft('m-1'));
    const connectors = new InMemoryConnectorRepository(members);
    await connectors.save(mkConnector('m-1', 'c-1', 'active'));
    expect(await connectors.listActive(assoc.value)).toHaveLength(0);
  });

  test('listActive skips connector whose member is missing', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    await connectors.save(mkConnector('ghost', 'c-1', 'active'));
    expect(await connectors.listActive(assoc.value)).toHaveLength(0);
  });
});

describe('InMemoryApprovalRepository', () => {
  const rec: FourEyesApproval = {
    id: 'a-1',
    subject_type: 'member_activation',
    subject_id: 's-1',
    state: 'pending',
    first_approval: null,
    second_approval: null,
    created_at: 'now',
  };

  test('save & find', async () => {
    const r = new InMemoryApprovalRepository();
    await r.save(rec);
    expect((await r.find('a-1'))?.id).toBe('a-1');
    expect(await r.find('x')).toBeNull();
  });

  test('findBySubject', async () => {
    const r = new InMemoryApprovalRepository();
    await r.save(rec);
    expect((await r.findBySubject('member_activation', 's-1'))?.id).toBe('a-1');
    expect(await r.findBySubject('member_activation', 'other')).toBeNull();
    expect(await r.findBySubject('connector_registration', 's-1')).toBeNull();
  });
});
