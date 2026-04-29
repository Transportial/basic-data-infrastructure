// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  parseAssociationId,
  parseEuid,
  FakeClock,
  type Jwk,
} from '@transportial/kernel';
import { FakeEventBus, DeterministicUuidGenerator, FakeSigner } from '@transportial/testing';
import {
  InMemoryApprovalRepository,
  InMemoryConnectorRepository,
  InMemoryMemberRepository,
} from '../../src/infrastructure/repositories/in-memory.ts';
import { AlwaysFailureSource, AlwaysSuccessSource } from '../fixtures/fake-sources.ts';
import { StartOnboardingUseCase } from '../../src/application/use-cases/start-onboarding.ts';
import { RunVerificationsUseCase } from '../../src/application/use-cases/run-verifications.ts';
import { ActivateMemberUseCase } from '../../src/application/use-cases/activate-member.ts';
import { ChangeMemberStatusUseCase } from '../../src/application/use-cases/change-member-status.ts';
import { RegisterConnectorUseCase } from '../../src/application/use-cases/register-connector.ts';
import { IssueBvadUseCase } from '../../src/application/use-cases/issue-bvad.ts';
import { BuildTrustlistUseCase } from '../../src/application/use-cases/build-trustlist.ts';
import { InMemoryTokensJournal } from '../../src/application/use-cases/issued-tokens-journal.ts';

const euid = parseEuid('NL.NHR.12345678');
if (!euid.ok) throw new Error('bad fixture');
const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('bad fixture');

const repInput = {
  subject_id: 'subj-1',
  auth_source: 'eHerkenning' as const,
  assurance: 'high' as const,
  verified_at: '2026-04-01T00:00:00Z',
};

describe('StartOnboardingUseCase', () => {
  let members: InMemoryMemberRepository;
  let ids: DeterministicUuidGenerator;
  let clock: FakeClock;
  let bus: FakeEventBus;
  let uc: StartOnboardingUseCase;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    ids = new DeterministicUuidGenerator();
    clock = new FakeClock('2026-04-23T10:00:00Z');
    bus = new FakeEventBus();
    uc = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
  });

  test('creates draft and emits event', async () => {
    const r = await uc.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme BV',
      signing_representative: repInput,
    });
    expect(r.ok).toBe(true);
    const stored = await members.findByEuid(euid.value);
    expect(stored?.status).toBe('draft');
    expect(bus.findAllOfType('asr.member.draft-created')).toHaveLength(1);
  });

  test('rejects duplicate registration', async () => {
    await uc.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    const r = await uc.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    expect(!r.ok && r.error.type).toBe('already-registered');
  });

  test('accepts optional vat/lei', async () => {
    const r = await uc.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: null,
      vat_number: 'NL123',
      lei: 'HWUPKR0MPOU8FGXBT394',
    });
    expect(r.ok).toBe(true);
    const m = await members.findByEuid(euid.value);
    expect(m?.vat_number).toBe('NL123');
    expect(m?.lei).toBe('HWUPKR0MPOU8FGXBT394');
  });
});

describe('RunVerificationsUseCase', () => {
  test('runs all sources and transitions to verified', async () => {
    const members = new InMemoryMemberRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');

    const uc = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    const out = await uc.execute(r.value.memberId);
    expect(out.ok).toBe(true);
    const member = await members.find(r.value.memberId);
    expect(member?.status).toBe('verified');
    expect(member?.assurance_level).toBe('high');
  });

  test('all failures → no-verifications at transition', async () => {
    const members = new InMemoryMemberRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');

    // When all fail but still recorded, assurance is null; markVerified still
    // transitions (Result carries null assurance) — the status is 'verified'.
    const uc = new RunVerificationsUseCase(
      members,
      [new AlwaysFailureSource('KvK')],
      clock,
      bus,
    );
    const out = await uc.execute(r.value.memberId);
    expect(out.ok).toBe(true);
  });

  test('rejects unknown member', async () => {
    const members = new InMemoryMemberRepository();
    const uc = new RunVerificationsUseCase(
      members,
      [],
      new FakeClock(),
      new FakeEventBus(),
    );
    const r = await uc.execute('missing');
    expect(!r.ok && r.error.type).toBe('member-not-found');
  });

  test('rejects already-verified', async () => {
    const members = new InMemoryMemberRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const uc = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK')],
      clock,
      bus,
    );
    await uc.execute(r.value.memberId);
    const second = await uc.execute(r.value.memberId);
    expect(!second.ok && second.error.type).toBe('bad-state');
  });
});

describe('ActivateMemberUseCase (4-eyes)', () => {
  async function setup() {
    const members = new InMemoryMemberRepository();
    const approvals = new InMemoryApprovalRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    return {
      members,
      approvals,
      bus,
      memberId: r.value.memberId,
      uc: new ActivateMemberUseCase(
        members,
        approvals,
        { newUuid: () => ids.next() },
        clock,
        bus,
      ),
    };
  }

  test('first approver → awaiting-second-approval', async () => {
    const { uc, memberId } = await setup();
    const r = await uc.execute({ memberId, approver: 'alice' });
    expect(r.ok && r.value.state).toBe('awaiting-second-approval');
  });

  test('distinct second approver → activated', async () => {
    const { uc, memberId, members, bus } = await setup();
    await uc.execute({ memberId, approver: 'alice' });
    const r = await uc.execute({ memberId, approver: 'bob' });
    expect(r.ok && r.value.state).toBe('activated');
    const m = await members.find(memberId);
    expect(m?.status).toBe('activated');
    expect(bus.findAllOfType('asr.member.activated')).toHaveLength(1);
  });

  test('self-approval forbidden', async () => {
    const { uc, memberId } = await setup();
    await uc.execute({ memberId, approver: 'alice' });
    const r = await uc.execute({ memberId, approver: 'alice' });
    expect(!r.ok && r.error.type).toBe('self-approval-forbidden');
  });

  test('rejects unknown member', async () => {
    const { uc } = await setup();
    const r = await uc.execute({ memberId: 'missing', approver: 'alice' });
    expect(!r.ok && r.error.type).toBe('member-not-found');
  });

  test('rejects already-active member', async () => {
    const { uc, memberId } = await setup();
    await uc.execute({ memberId, approver: 'alice' });
    await uc.execute({ memberId, approver: 'bob' });
    const r = await uc.execute({ memberId, approver: 'carol' });
    expect(!r.ok && r.error.type).toBe('already-active');
  });

  test('rejects not-verified member', async () => {
    const members = new InMemoryMemberRepository();
    const approvals = new InMemoryApprovalRepository();
    const clock = new FakeClock();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const uc = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const out = await uc.execute({ memberId: r.value.memberId, approver: 'alice' });
    expect(!out.ok && out.error.type).toBe('not-verified');
  });

  test('missing rep at activation → missing-signing-representative', async () => {
    const members = new InMemoryMemberRepository();
    const approvals = new InMemoryApprovalRepository();
    const clock = new FakeClock();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: null,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    const uc = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await uc.execute({ memberId: r.value.memberId, approver: 'alice' });
    const out = await uc.execute({ memberId: r.value.memberId, approver: 'bob' });
    expect(!out.ok && out.error.type).toBe('missing-signing-representative');
  });
});

describe('ChangeMemberStatusUseCase', () => {
  async function setup() {
    const members = new InMemoryMemberRepository();
    const approvals = new InMemoryApprovalRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    const act = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await act.execute({ memberId: r.value.memberId, approver: 'alice' });
    await act.execute({ memberId: r.value.memberId, approver: 'bob' });
    return {
      members,
      bus,
      memberId: r.value.memberId,
      uc: new ChangeMemberStatusUseCase(members, clock, bus),
    };
  }

  test('suspend an active member', async () => {
    const { uc, memberId, bus } = await setup();
    const r = await uc.execute(memberId, 'suspend');
    expect(r.ok).toBe(true);
    expect(bus.findAllOfType('asr.member.suspended')).toHaveLength(1);
  });

  test('reinstate a suspended member', async () => {
    const { uc, memberId } = await setup();
    await uc.execute(memberId, 'suspend');
    const r = await uc.execute(memberId, 'reinstate');
    expect(r.ok).toBe(true);
  });

  test('revoke an active member', async () => {
    const { uc, memberId } = await setup();
    const r = await uc.execute(memberId, 'revoke');
    expect(r.ok).toBe(true);
  });

  test('unknown member → member-not-found', async () => {
    const { uc } = await setup();
    const r = await uc.execute('missing', 'suspend');
    expect(!r.ok && r.error.type).toBe('member-not-found');
  });

  test('invalid transition → error', async () => {
    const { uc, memberId } = await setup();
    await uc.execute(memberId, 'revoke');
    const r = await uc.execute(memberId, 'suspend');
    expect(!r.ok).toBe(true);
  });
});

describe('RegisterConnectorUseCase', () => {
  async function activatedMember() {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const approvals = new InMemoryApprovalRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    const act = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await act.execute({ memberId: r.value.memberId, approver: 'alice' });
    await act.execute({ memberId: r.value.memberId, approver: 'bob' });
    return {
      members,
      connectors,
      bus,
      memberId: r.value.memberId,
      ids,
      clock,
      uc: new RegisterConnectorUseCase(
        members,
        connectors,
        { newUuid: () => ids.next() },
        clock,
        bus,
      ),
    };
  }

  const goodJwk: Jwk = { kty: 'OKP', crv: 'Ed25519', x: 'xyz' };

  test('registers a pending connector', async () => {
    const { uc, memberId, connectors } = await activatedMember();
    const r = await uc.execute({
      memberId,
      clientId: 'client-1',
      jwk: goodJwk,
      kid: 'k1',
      certThumbprint: 'tp',
      certNotAfter: 9_999_999_999,
      callbackUrls: ['https://example.com/hook'],
      authorisedBy: 'rep-1',
    });
    expect(r.ok).toBe(true);
    const found = await connectors.findByClientId('client-1');
    expect(found?.status).toBe('pending');
  });

  test('rejects unknown member', async () => {
    const { uc } = await activatedMember();
    const r = await uc.execute({
      memberId: 'missing',
      clientId: 'c',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    expect(!r.ok && r.error.type).toBe('member-not-found');
  });

  test('rejects non-active member', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const uc = new RegisterConnectorUseCase(
      members,
      connectors,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const out = await uc.execute({
      memberId: r.value.memberId,
      clientId: 'c',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    expect(!out.ok && out.error.type).toBe('member-not-active');
  });

  test('rejects bad jwk', async () => {
    const { uc, memberId } = await activatedMember();
    const r = await uc.execute({
      memberId,
      clientId: 'c',
      jwk: { kty: 'oct' } as unknown as Jwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    expect(!r.ok && r.error.type).toBe('bad-jwk');
  });

  test('rejects bad callback url', async () => {
    const { uc, memberId } = await activatedMember();
    const r = await uc.execute({
      memberId,
      clientId: 'c',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: ['http://evil.example.com'],
      authorisedBy: 'r',
    });
    expect(!r.ok && r.error.type).toBe('bad-callback-url');
  });

  test('rejects duplicate client id', async () => {
    const { uc, memberId } = await activatedMember();
    await uc.execute({
      memberId,
      clientId: 'c1',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    const r = await uc.execute({
      memberId,
      clientId: 'c1',
      jwk: goodJwk,
      kid: 'k2',
      certThumbprint: 'tp2',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    expect(!r.ok && r.error.type).toBe('client-id-taken');
  });

  test('rejects bad generated connector id', async () => {
    const { connectors, memberId, members, clock, bus } = await activatedMember();
    const uc = new RegisterConnectorUseCase(
      members,
      connectors,
      { newUuid: () => 'not-a-uuid' },
      clock,
      bus,
    );
    const r = await uc.execute({
      memberId,
      clientId: 'cx',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'r',
    });
    expect(!r.ok && r.error.type).toBe('bad-connector-id');
  });
});

describe('IssueBvadUseCase', () => {
  const goodJwk: Jwk = { kty: 'OKP', crv: 'Ed25519', x: 'xyz' };
  async function setup() {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const approvals = new InMemoryApprovalRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    const act = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await act.execute({ memberId: r.value.memberId, approver: 'alice' });
    await act.execute({ memberId: r.value.memberId, approver: 'bob' });
    const reg = new RegisterConnectorUseCase(
      members,
      connectors,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const c = await reg.execute({
      memberId: r.value.memberId,
      clientId: 'client-1',
      jwk: goodJwk,
      kid: 'k1',
      certThumbprint: 'tp',
      certNotAfter: 9_999_999_999,
      callbackUrls: [],
      authorisedBy: 'rep',
    });
    if (!c.ok) throw new Error('setup');
    // Promote connector to active
    const con = await connectors.findByClientId('client-1');
    if (!con) throw new Error('setup');
    await connectors.save({ ...con, status: 'active' });

    const signer = new FakeSigner('asr-2026-01');
    const journal = new InMemoryTokensJournal();
    const uc = new IssueBvadUseCase(
      members,
      connectors,
      signer,
      clock,
      { newUuid: () => ids.next() },
      bus,
      journal,
      { issuer: 'https://asr.ctn.bdi.nl' },
    );
    return { uc, connectors, members, signer, bus, journal };
  }

  test('issues a JWS BVAD', async () => {
    const { uc, signer } = await setup();
    const r = await uc.execute({ clientId: 'client-1', audience: 'urn:bdi:association:ctn' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const verified = await signer.verifyJwt(r.value);
      expect((verified as { iss: string }).iss).toBe('https://asr.ctn.bdi.nl');
    }
  });

  test('unknown client', async () => {
    const { uc } = await setup();
    const r = await uc.execute({ clientId: 'unknown', audience: 'a' });
    expect(!r.ok && r.error.type).toBe('unknown-client');
  });

  test('rejects inactive connector', async () => {
    const { uc, connectors } = await setup();
    const con = await connectors.findByClientId('client-1');
    if (!con) throw new Error('setup');
    await connectors.save({ ...con, status: 'suspended' });
    const r = await uc.execute({ clientId: 'client-1', audience: 'a' });
    expect(!r.ok && r.error.type).toBe('connector-not-active');
  });

  test('rejects non-activated member', async () => {
    const { uc, members, connectors } = await setup();
    const list = await members.listByAssociation(assoc.value);
    const m = list[0]!;
    await members.save({ ...m, status: 'suspended' });
    // connector still active; but member gates it
    const con = (await connectors.findByClientId('client-1'))!;
    await connectors.save({ ...con, status: 'active' });
    const r = await uc.execute({ clientId: 'client-1', audience: 'a' });
    expect(!r.ok && r.error.type).toBe('member-not-activated');
  });
});

describe('BuildTrustlistUseCase', () => {
  const goodJwk: Jwk = { kty: 'OKP', crv: 'Ed25519', x: 'xyz' };
  test('builds and signs a trustlist; version increments', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const approvals = new InMemoryApprovalRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const start = new StartOnboardingUseCase(
      members,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await start.execute({
      euid: euid.value,
      association_id: assoc.value,
      legal_name: 'Acme',
      signing_representative: repInput,
    });
    if (!r.ok) throw new Error('setup');
    const verify = new RunVerificationsUseCase(
      members,
      [new AlwaysSuccessSource('KvK'), new AlwaysSuccessSource('VIES')],
      clock,
      bus,
    );
    await verify.execute(r.value.memberId);
    const act = new ActivateMemberUseCase(
      members,
      approvals,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await act.execute({ memberId: r.value.memberId, approver: 'alice' });
    await act.execute({ memberId: r.value.memberId, approver: 'bob' });
    const reg = new RegisterConnectorUseCase(
      members,
      connectors,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const c = await reg.execute({
      memberId: r.value.memberId,
      clientId: 'c1',
      jwk: goodJwk,
      kid: 'k',
      certThumbprint: 'tp',
      certNotAfter: 0,
      callbackUrls: [],
      authorisedBy: 'rep',
    });
    if (!c.ok) throw new Error('setup');
    const con = (await connectors.findByClientId('c1'))!;
    await connectors.save({ ...con, status: 'active' });

    const signer = new FakeSigner('asr-2026-01');
    const uc = new BuildTrustlistUseCase(connectors, signer, clock, {
      issuer: 'https://asr.ctn.bdi.nl',
    });
    const first = await uc.execute(assoc.value);
    const second = await uc.execute(assoc.value);
    expect(first.ok && first.value.version).toBe(1);
    expect(second.ok && second.value.version).toBe(2);
    if (first.ok) expect(first.value.list.entries).toHaveLength(1);
  });

  test('empty when no active connectors', async () => {
    const members = new InMemoryMemberRepository();
    const connectors = new InMemoryConnectorRepository(members);
    const signer = new FakeSigner('k1');
    const uc = new BuildTrustlistUseCase(connectors, signer, new FakeClock(), {
      issuer: 'https://asr',
    });
    const r = await uc.execute(assoc.value);
    if (r.ok) expect(r.value.list.entries).toHaveLength(0);
  });
});
