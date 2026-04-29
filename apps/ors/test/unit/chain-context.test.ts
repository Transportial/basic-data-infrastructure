// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { parseAssociationId, parseChainContextId, parseEuid } from '@transportial/kernel';
import { createChainContext } from '../../src/domain/model/chain-context.ts';
import {
  activateContext,
  addDelegation,
  addParty,
  addRolePerson,
  cancelContext,
  completeContext,
  effectiveRoles,
  isParty,
  partyRoles,
  removeParty,
} from '../../src/domain/model/context-transitions.ts';
import { deactivate, validateSubscription } from '../../src/domain/model/subscription.ts';
import { pseudonymise } from '../../src/domain/pseudonym.ts';
import { parseConnectorId } from '@transportial/kernel';

const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('setup');
const orch = parseEuid('NL.NHR.11111111');
const other = parseEuid('NL.NHR.22222222');
const third = parseEuid('NL.NHR.33333333');
if (!orch.ok || !other.ok || !third.ok) throw new Error('setup');
const ctxId = parseChainContextId('9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!ctxId.ok) throw new Error('setup');
const conId = parseConnectorId('urn:bdi:connector:9f3a2c10-1234-4abc-89ab-cdef01234567');
if (!conId.ok) throw new Error('setup');

function ctx() {
  return createChainContext({
    id: ctxId.value,
    association_id: assoc.value,
    orchestrator_member_id: orch.value,
    kind: 'shipment',
    identifiers: [{ scheme: 'bl', value: 'MSCU123' }],
    valid_from: '2026-04-23T00:00:00Z',
    valid_until: null,
    created_at: '2026-04-23T00:00:00Z',
  });
}

describe('createChainContext', () => {
  test('includes orchestrator as party', () => {
    const c = ctx();
    expect(c.parties).toHaveLength(1);
    expect(c.parties[0]?.member_euid).toBe(orch.value);
    expect(c.parties[0]?.roles).toContain('orchestrator');
  });

  test('starts in planned status', () => {
    expect(ctx().status).toBe('planned');
  });
});

describe('addParty', () => {
  test('adds a new party', () => {
    const c = ctx();
    const r = addParty(c, {
      member_euid: other.value,
      roles: ['carrier'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    expect(r.ok && r.value.parties).toHaveLength(2);
  });

  test('rejects duplicate party', () => {
    const c = ctx();
    const r = addParty(c, {
      member_euid: orch.value,
      roles: ['x'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    expect(!r.ok && r.error.type).toBe('party-already-present');
  });
});

describe('removeParty', () => {
  test('cannot remove orchestrator', () => {
    const r = removeParty(ctx(), orch.value);
    expect(!r.ok && r.error.type).toBe('cannot-remove-orchestrator');
  });

  test('rejects removing absent party', () => {
    const r = removeParty(ctx(), other.value);
    expect(!r.ok && r.error.type).toBe('party-not-present');
  });

  test('removes a present party', () => {
    let c = ctx();
    const added = addParty(c, {
      member_euid: other.value,
      roles: ['x'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    if (!added.ok) throw new Error('setup');
    c = added.value;
    const r = removeParty(c, other.value);
    expect(r.ok && r.value.parties).toHaveLength(1);
  });
});

describe('addDelegation', () => {
  function fullCtx() {
    let c = ctx();
    const a1 = addParty(c, {
      member_euid: other.value,
      roles: ['carrier'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    if (!a1.ok) throw new Error('setup');
    c = a1.value;
    const a2 = addParty(c, {
      member_euid: third.value,
      roles: ['consignee'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    if (!a2.ok) throw new Error('setup');
    return a2.value;
  }

  test('adds delegation between parties', () => {
    const r = addDelegation(fullCtx(), {
      delegator: other.value,
      delegate: third.value,
      action_scope: ['read:eta'],
      valid_until: null,
      authorised_at: 'x',
    });
    expect(r.ok && r.value.delegations).toHaveLength(1);
  });

  test('rejects when delegator absent', () => {
    const r = addDelegation(ctx(), {
      delegator: other.value,
      delegate: orch.value,
      action_scope: [],
      valid_until: null,
      authorised_at: 'x',
    });
    expect(!r.ok && r.error.type).toBe('delegator-not-present');
  });

  test('rejects when delegate absent', () => {
    const r = addDelegation(ctx(), {
      delegator: orch.value,
      delegate: other.value,
      action_scope: [],
      valid_until: null,
      authorised_at: 'x',
    });
    expect(!r.ok && r.error.type).toBe('delegate-not-present');
  });
});

describe('addRolePerson', () => {
  test('adds person', () => {
    const r = addRolePerson(ctx(), {
      pseudonym: 'p1',
      role: 'driver',
      organisation_euid: orch.value,
      valid_from: 'x',
      valid_until: null,
    });
    expect(r.ok && r.value.natural_persons).toHaveLength(1);
  });

  test('rejects duplicate pseudonym', () => {
    let c = ctx();
    const r1 = addRolePerson(c, {
      pseudonym: 'p1',
      role: 'driver',
      organisation_euid: orch.value,
      valid_from: 'x',
      valid_until: null,
    });
    if (!r1.ok) throw new Error('setup');
    c = r1.value;
    const r2 = addRolePerson(c, {
      pseudonym: 'p1',
      role: 'skipper',
      organisation_euid: orch.value,
      valid_from: 'x',
      valid_until: null,
    });
    expect(!r2.ok && r2.error.type).toBe('duplicate-pseudonym');
  });
});

describe('status transitions', () => {
  test('activate planned → active', () => {
    const r = activateContext(ctx());
    expect(r.ok && r.value.status).toBe('active');
  });
  test('activate already-active fails', () => {
    const a = activateContext(ctx());
    if (!a.ok) throw new Error('setup');
    const r = activateContext(a.value);
    expect(!r.ok).toBe(true);
  });
  test('complete active → completed', () => {
    const a = activateContext(ctx());
    if (!a.ok) throw new Error('setup');
    const r = completeContext(a.value);
    expect(r.ok && r.value.status).toBe('completed');
  });
  test('complete planned fails', () => {
    const r = completeContext(ctx());
    expect(!r.ok).toBe(true);
  });
  test('cancel planned → cancelled', () => {
    const r = cancelContext(ctx());
    expect(r.ok && r.value.status).toBe('cancelled');
  });
  test('cancel completed fails', () => {
    const a = activateContext(ctx());
    if (!a.ok) throw new Error('setup');
    const c = completeContext(a.value);
    if (!c.ok) throw new Error('setup');
    const r = cancelContext(c.value);
    expect(!r.ok).toBe(true);
  });
  test('cancel cancelled fails', () => {
    const c = cancelContext(ctx());
    if (!c.ok) throw new Error('setup');
    const r = cancelContext(c.value);
    expect(!r.ok).toBe(true);
  });
});

describe('queries', () => {
  test('isParty orchestrator', () => {
    expect(isParty(ctx(), orch.value)).toBe(true);
    expect(isParty(ctx(), other.value)).toBe(false);
  });

  test('partyRoles', () => {
    expect(partyRoles(ctx(), orch.value)).toContain('orchestrator');
    expect(partyRoles(ctx(), other.value)).toHaveLength(0);
  });

  test('effectiveRoles includes delegations', () => {
    let c = ctx();
    const a1 = addParty(c, {
      member_euid: other.value,
      roles: ['carrier'],
      added_at: 'x',
      added_by_member: orch.value,
      valid_from: 'y',
      valid_until: null,
    });
    if (!a1.ok) throw new Error('setup');
    c = a1.value;
    const d = addDelegation(c, {
      delegator: orch.value,
      delegate: other.value,
      action_scope: ['custom:scope'],
      valid_until: null,
      authorised_at: 'x',
    });
    if (!d.ok) throw new Error('setup');
    const roles = effectiveRoles(d.value, other.value);
    expect(roles).toContain('carrier');
    expect(roles).toContain('custom:scope');
  });
});

describe('Subscription', () => {
  test('validate happy path', () => {
    const r = validateSubscription({
      id: 's-1',
      chain_context_id: ctxId.value,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['eta_updated'],
      callback_url: 'https://example.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    expect(r.ok).toBe(true);
  });

  test('empty event types rejected', () => {
    const r = validateSubscription({
      id: 's-1',
      chain_context_id: ctxId.value,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: [],
      callback_url: 'https://example.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    expect(!r.ok && r.error.type).toBe('empty-event-types');
  });

  test('unlisted callback rejected', () => {
    const r = validateSubscription({
      id: 's-1',
      chain_context_id: ctxId.value,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['x'],
      callback_url: 'https://evil.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    expect(!r.ok && r.error.type).toBe('bad-callback-url');
  });

  test('deactivate flips active flag', () => {
    const r = validateSubscription({
      id: 's-1',
      chain_context_id: ctxId.value,
      subscriber_euid: other.value,
      subscriber_connector_id: conId.value,
      event_types: ['x'],
      callback_url: 'https://example.com/hook',
      allowedCallbacks: ['https://example.com/hook'],
      created_at: 'now',
    });
    if (!r.ok) throw new Error('setup');
    expect(deactivate(r.value).active).toBe(false);
  });
});

describe('pseudonymise', () => {
  test('deterministic', async () => {
    const a = await pseudonymise(orch.value, 'driver-1', 'salt');
    const b = await pseudonymise(orch.value, 'driver-1', 'salt');
    expect(a).toBe(b);
  });

  test('different inputs → different output', async () => {
    const a = await pseudonymise(orch.value, 'driver-1', 'salt');
    const b = await pseudonymise(orch.value, 'driver-2', 'salt');
    expect(a).not.toBe(b);
  });

  test('different salt → different output', async () => {
    const a = await pseudonymise(orch.value, 'driver-1', 'a');
    const b = await pseudonymise(orch.value, 'driver-1', 'b');
    expect(a).not.toBe(b);
  });
});
