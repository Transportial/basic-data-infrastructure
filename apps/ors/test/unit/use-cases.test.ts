// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  FakeClock,
  parseAssociationId,
  parseConnectorId,
  parseEuid,
  type ChainContextId,
} from '@bdi/kernel';
import { FakeEventBus, DeterministicUuidGenerator } from '@bdi/testing';
import {
  InMemoryChainContextRepository,
  InMemorySubscriptionRepository,
} from '../../src/infrastructure/repositories/in-memory.ts';
import { InMemoryConnectorLookup } from '../../src/infrastructure/connector-lookup.ts';
import { JwsSigner, randomSigningKey } from '../../src/infrastructure/crypto/signer.ts';
import { CreateChainContextUseCase } from '../../src/application/use-cases/create-chain-context.ts';
import {
  AddDelegationUseCase,
  AddPartyUseCase,
  RemovePartyUseCase,
} from '../../src/application/use-cases/manage-parties.ts';
import { IssueBvodUseCase, scopeFromRoles } from '../../src/application/use-cases/issue-bvod.ts';
import { SubscribeUseCase } from '../../src/application/use-cases/subscribe.ts';
import { PublishContextEventUseCase } from '../../src/application/use-cases/publish-event.ts';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const orch = parseEuid('NL.NHR.11111111');
const other = parseEuid('NL.NHR.22222222');
if (!orch.ok || !other.ok) throw new Error('setup');
const conId = parseConnectorId('urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

describe('CreateChainContextUseCase', () => {
  test('creates and publishes event', async () => {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const clock = new FakeClock();
    const bus = new FakeEventBus();
    const uc = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await uc.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'now',
      valid_until: null,
    });
    expect(r.ok).toBe(true);
    expect(bus.findAllOfType('ors.context.created')).toHaveLength(1);
  });

  test('bad id generator → bad-id-generator', async () => {
    const uc = new CreateChainContextUseCase(
      new InMemoryChainContextRepository(),
      { newUuid: () => 'not-a-uuid' },
      new FakeClock(),
      new FakeEventBus(),
    );
    const r = await uc.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('bad-id-generator');
  });
});

describe('AddPartyUseCase', () => {
  let contexts: InMemoryChainContextRepository;
  let ids: DeterministicUuidGenerator;
  let bus: FakeEventBus;
  let ctxId: ChainContextId;
  beforeEach(async () => {
    contexts = new InMemoryChainContextRepository();
    ids = new DeterministicUuidGenerator();
    bus = new FakeEventBus();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      new FakeClock(),
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    ctxId = r.value.chainContextId;
  });

  test('orchestrator can add a party', async () => {
    const uc = new AddPartyUseCase(contexts, new FakeClock(), bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    expect(r.ok).toBe(true);
  });

  test('non-orchestrator cannot add', async () => {
    const uc = new AddPartyUseCase(contexts, new FakeClock(), bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: other.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('not-authorised');
  });

  test('missing context', async () => {
    const uc = new AddPartyUseCase(contexts, new FakeClock(), bus);
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: [],
      valid_from: 'x',
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });

  test('duplicate party', async () => {
    const uc = new AddPartyUseCase(contexts, new FakeClock(), bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: orch.value,
      member_euid: orch.value,
      roles: [],
      valid_from: 'x',
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('party-already-present');
  });
});

describe('RemovePartyUseCase', () => {
  test('happy path', async () => {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      new FakeClock(),
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const addPartyUc = new AddPartyUseCase(contexts, new FakeClock(), bus);
    await addPartyUc.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    const removeUc = new RemovePartyUseCase(contexts, bus);
    const out = await removeUc.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
    });
    expect(out.ok).toBe(true);
  });

  test('not authorised', async () => {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      new FakeClock(),
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const uc = new RemovePartyUseCase(contexts, bus);
    const out = await uc.execute({
      chain_context_id: r.value.chainContextId,
      actor: other.value,
      member_euid: other.value,
    });
    expect(!out.ok && out.error.type).toBe('not-authorised');
  });

  test('missing context', async () => {
    const uc = new RemovePartyUseCase(
      new InMemoryChainContextRepository(),
      new FakeEventBus(),
    );
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      actor: orch.value,
      member_euid: other.value,
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });

  test('propagates domain error (e.g. cannot-remove-orchestrator)', async () => {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      new FakeClock(),
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const uc = new RemovePartyUseCase(contexts, bus);
    const out = await uc.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: orch.value,
    });
    expect(!out.ok && out.error.type).toBe('cannot-remove-orchestrator');
  });
});

describe('AddDelegationUseCase', () => {
  async function setup() {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const clock = new FakeClock();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const add = new AddPartyUseCase(contexts, clock, bus);
    await add.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    return { contexts, bus, clock, ctxId: r.value.chainContextId };
  }

  test('delegator can delegate', async () => {
    const { contexts, bus, clock, ctxId } = await setup();
    const uc = new AddDelegationUseCase(contexts, clock, bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: other.value,
      delegator: other.value,
      delegate: orch.value,
      action_scope: ['read:x'],
      valid_until: null,
    });
    expect(r.ok).toBe(true);
  });

  test('orchestrator can delegate on behalf', async () => {
    const { contexts, bus, clock, ctxId } = await setup();
    const uc = new AddDelegationUseCase(contexts, clock, bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: orch.value,
      delegator: other.value,
      delegate: orch.value,
      action_scope: ['read:x'],
      valid_until: null,
    });
    expect(r.ok).toBe(true);
  });

  test('others cannot delegate', async () => {
    const { contexts, bus, clock, ctxId } = await setup();
    const uc = new AddDelegationUseCase(contexts, clock, bus);
    const r = await uc.execute({
      chain_context_id: ctxId,
      actor: orch.value,
      delegator: orch.value,
      delegate: '00000000-0000-4000-8000-000000000099' as unknown as typeof orch.value,
      action_scope: ['x'],
      valid_until: null,
    });
    expect(!r.ok).toBe(true);
  });

  test('context not found', async () => {
    const uc = new AddDelegationUseCase(
      new InMemoryChainContextRepository(),
      new FakeClock(),
      new FakeEventBus(),
    );
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      actor: orch.value,
      delegator: orch.value,
      delegate: other.value,
      action_scope: [],
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });
});

describe('IssueBvodUseCase', () => {
  async function setup() {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const clock = new FakeClock();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [{ scheme: 'bl', value: 'MSCU123' }],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const add = new AddPartyUseCase(contexts, clock, bus);
    await add.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    const signer = new JwsSigner({ kid: 'ors-01', key: randomSigningKey() });
    const uc = new IssueBvodUseCase(contexts, signer, clock, { newUuid: () => ids.next() }, bus, {
      issuer: 'https://ors.ctn',
    });
    return { uc, ctxId: r.value.chainContextId, signer };
  }

  test('issues BVOD for involved party', async () => {
    const { uc, ctxId, signer } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subject_euid: other.value,
      subject_connector_id: conId.value,
      audience: conId.value,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const claims = await signer.verifyJwt(r.value);
      expect((claims as { iss: string }).iss).toBe('https://ors.ctn');
    }
  });

  test('rejects non-involved', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subject_euid: 'NL.NHR.99999999' as unknown as typeof other.value,
      subject_connector_id: conId.value,
      audience: conId.value,
    });
    expect(!r.ok && r.error.type).toBe('not-involved');
  });

  test('rejects missing context', async () => {
    const { uc } = await setup();
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      subject_euid: other.value,
      subject_connector_id: conId.value,
      audience: conId.value,
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });

  test('rejects completed context', async () => {
    const contexts = new InMemoryChainContextRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const clock = new FakeClock();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    // set to 'completed'
    const ctx = await contexts.find(r.value.chainContextId);
    if (!ctx) throw new Error('setup');
    await contexts.save({ ...ctx, status: 'completed' });

    const signer = new JwsSigner({ kid: 'o', key: randomSigningKey() });
    const uc = new IssueBvodUseCase(contexts, signer, clock, { newUuid: () => ids.next() }, bus, {
      issuer: 'https://ors',
    });
    const out = await uc.execute({
      chain_context_id: r.value.chainContextId,
      subject_euid: orch.value,
      subject_connector_id: conId.value,
      audience: conId.value,
    });
    expect(!out.ok && out.error.type).toBe('context-not-active');
  });
});

describe('scopeFromRoles', () => {
  test('maps known roles', () => {
    expect(scopeFromRoles(['carrier'])).toContain('read:eta');
  });
  test('deduplicates across roles', () => {
    const s = scopeFromRoles(['carrier', 'shipper']);
    const occurrences = s.filter((x) => x === 'read:eta').length;
    expect(occurrences).toBe(1);
  });
  test('unknown role → empty', () => {
    expect(scopeFromRoles(['mystery'])).toHaveLength(0);
  });
});

describe('SubscribeUseCase', () => {
  async function setup() {
    const contexts = new InMemoryChainContextRepository();
    const subs = new InMemorySubscriptionRepository();
    const connectors = new InMemoryConnectorLookup();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const clock = new FakeClock();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const add = new AddPartyUseCase(contexts, clock, bus);
    await add.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    connectors.register(conId.value, ['https://example.com/hook']);
    const uc = new SubscribeUseCase(
      contexts,
      subs,
      connectors,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    return { uc, subs, ctxId: r.value.chainContextId, connectors };
  }

  test('happy path', async () => {
    const { uc, ctxId, subs } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['eta_updated'],
      callback_url: 'https://example.com/hook',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(await subs.find(r.value.subscriptionId)).toBeTruthy();
    }
  });

  test('rejects non-involved', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subscriber_euid: 'NL.NHR.99999999' as unknown as typeof other.value,
      subscriber_connector_id: conId.value,
      event_types: ['x'],
      callback_url: 'https://example.com/hook',
    });
    expect(!r.ok && r.error.type).toBe('not-involved');
  });

  test('rejects unknown callback', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['x'],
      callback_url: 'https://evil.com/hook',
    });
    expect(!r.ok && r.error.type).toBe('bad-callback-url');
  });

  test('rejects empty event types', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: [],
      callback_url: 'https://example.com/hook',
    });
    expect(!r.ok && r.error.type).toBe('empty-event-types');
  });

  test('missing context', async () => {
    const { uc } = await setup();
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['x'],
      callback_url: 'https://example.com/hook',
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });
});

describe('PublishContextEventUseCase', () => {
  async function setup() {
    const contexts = new InMemoryChainContextRepository();
    const subs = new InMemorySubscriptionRepository();
    const ids = new DeterministicUuidGenerator();
    const bus = new FakeEventBus();
    const clock = new FakeClock();
    const create = new CreateChainContextUseCase(
      contexts,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    const r = await create.execute({
      association_id: assoc.value,
      orchestrator: orch.value,
      kind: 'shipment',
      identifiers: [],
      valid_from: 'x',
      valid_until: null,
    });
    if (!r.ok) throw new Error('setup');
    const add = new AddPartyUseCase(contexts, clock, bus);
    await add.execute({
      chain_context_id: r.value.chainContextId,
      actor: orch.value,
      member_euid: other.value,
      roles: ['carrier'],
      valid_from: 'x',
      valid_until: null,
    });
    const connectors = new InMemoryConnectorLookup();
    connectors.register(conId.value, ['https://example.com/hook']);
    const sub = new SubscribeUseCase(
      contexts,
      subs,
      connectors,
      { newUuid: () => ids.next() },
      clock,
      bus,
    );
    await sub.execute({
      chain_context_id: r.value.chainContextId,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['eta_updated'],
      callback_url: 'https://example.com/hook',
    });
    const uc = new PublishContextEventUseCase(contexts, subs, clock, bus);
    return { uc, ctxId: r.value.chainContextId, bus };
  }

  test('emits delivery for matching subscriber', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      publisher: orch.value,
      event_type: 'eta_updated',
      payload: { eta: '2026-05-01' },
    });
    expect(r.ok && r.value.deliveries).toHaveLength(1);
  });

  test('no deliveries for non-subscribed event type', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      publisher: orch.value,
      event_type: 'other',
      payload: {},
    });
    expect(r.ok && r.value.deliveries).toHaveLength(0);
  });

  test('rejects non-party publisher', async () => {
    const { uc, ctxId } = await setup();
    const r = await uc.execute({
      chain_context_id: ctxId,
      publisher: 'NL.NHR.99999999' as unknown as typeof orch.value,
      event_type: 'eta_updated',
      payload: {},
    });
    expect(!r.ok && r.error.type).toBe('not-involved');
  });

  test('missing context', async () => {
    const uc = new PublishContextEventUseCase(
      new InMemoryChainContextRepository(),
      new InMemorySubscriptionRepository(),
      new FakeClock(),
      new FakeEventBus(),
    );
    const r = await uc.execute({
      chain_context_id: '00000000-0000-4000-8000-000000000099' as unknown as ChainContextId,
      publisher: orch.value,
      event_type: 'x',
      payload: {},
    });
    expect(!r.ok && r.error.type).toBe('context-not-found');
  });
});
