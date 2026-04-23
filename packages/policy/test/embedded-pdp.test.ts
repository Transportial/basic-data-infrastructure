// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { EmbeddedPdp, conditions, matches, type Policy } from '../src/embedded-pdp.ts';
import type { PdpInput } from '../src/pdp.ts';

const baseInput: PdpInput = {
  subject: {
    connector_id: 'urn:bdi:connector:1',
    organisation_euid: 'NL.NHR.12345678',
    assurance: 'high',
    status: 'active',
  },
  context: { chain_context_id: 'c1', roles: ['carrier'] },
  action: 'read:shipment',
  resource: { type: 'Shipment', id: 's-1', tags: { visibility: 'shared' } },
};

describe('matches', () => {
  test('wildcard actions matches', () => {
    const p: Policy = { id: 'p', effect: 'permit', actions: '*' };
    expect(matches(p, baseInput)).toBe(true);
  });
  test('action list match', () => {
    const p: Policy = { id: 'p', effect: 'permit', actions: ['read:shipment'] };
    expect(matches(p, baseInput)).toBe(true);
  });
  test('action list no match', () => {
    const p: Policy = { id: 'p', effect: 'permit', actions: ['delete:x'] };
    expect(matches(p, baseInput)).toBe(false);
  });
  test('resourceTypes wildcard', () => {
    const p: Policy = { id: 'p', effect: 'permit', resourceTypes: '*' };
    expect(matches(p, baseInput)).toBe(true);
  });
  test('resourceTypes list match', () => {
    const p: Policy = { id: 'p', effect: 'permit', resourceTypes: ['Shipment'] };
    expect(matches(p, baseInput)).toBe(true);
  });
  test('resourceTypes list no match', () => {
    const p: Policy = { id: 'p', effect: 'permit', resourceTypes: ['Order'] };
    expect(matches(p, baseInput)).toBe(false);
  });
  test('when condition returns false', () => {
    const p: Policy = { id: 'p', effect: 'permit', when: () => false };
    expect(matches(p, baseInput)).toBe(false);
  });
  test('when condition returns true', () => {
    const p: Policy = { id: 'p', effect: 'permit', when: () => true };
    expect(matches(p, baseInput)).toBe(true);
  });
});

describe('EmbeddedPdp', () => {
  test('deny when no policy matches', async () => {
    const pdp = new EmbeddedPdp([]);
    const d = await pdp.decide(baseInput);
    expect(d.effect).toBe('deny');
    if (d.effect === 'deny') expect(d.reason).toBe('no-matching-policy');
  });

  test('permit when permit matches', async () => {
    const pdp = new EmbeddedPdp([{ id: 'allow-all', effect: 'permit', actions: '*' }]);
    const d = await pdp.decide(baseInput);
    expect(d.effect).toBe('permit');
  });

  test('forbid overrides permit (Cedar-style)', async () => {
    const pdp = new EmbeddedPdp([
      { id: 'allow-all', effect: 'permit', actions: '*' },
      {
        id: 'forbid-suspended',
        effect: 'forbid',
        actions: '*',
        when: (i) => i.subject.status !== 'active',
      },
    ]);
    const suspended: PdpInput = {
      ...baseInput,
      subject: { ...baseInput.subject, status: 'suspended' },
    };
    const d = await pdp.decide(suspended);
    expect(d.effect).toBe('deny');
  });

  test('forbid uses policy id when no explicit reason', async () => {
    const pdp = new EmbeddedPdp([
      { id: 'f1', effect: 'forbid', actions: '*' },
    ]);
    const d = await pdp.decide(baseInput);
    if (d.effect === 'deny') expect(d.reason).toBe('forbid:f1');
  });

  test('forbid uses explicit reason when provided', async () => {
    const pdp = new EmbeddedPdp([
      { id: 'f1', effect: 'forbid', actions: '*', reason: 'nope' },
    ]);
    const d = await pdp.decide(baseInput);
    if (d.effect === 'deny') expect(d.reason).toBe('nope');
  });
});

describe('conditions', () => {
  test('subjectActive', () => {
    expect(conditions.subjectActive()(baseInput)).toBe(true);
    expect(
      conditions.subjectActive()({
        ...baseInput,
        subject: { ...baseInput.subject, status: 'suspended' },
      }),
    ).toBe(false);
  });

  test('minAssurance: substantial passes anyone', () => {
    const low = { ...baseInput, subject: { ...baseInput.subject, assurance: 'substantial' as const } };
    expect(conditions.minAssurance('substantial')(baseInput)).toBe(true);
    expect(conditions.minAssurance('substantial')(low)).toBe(true);
  });

  test('minAssurance: high requires high', () => {
    expect(conditions.minAssurance('high')(baseInput)).toBe(true);
    expect(
      conditions.minAssurance('high')({
        ...baseInput,
        subject: { ...baseInput.subject, assurance: 'substantial' },
      }),
    ).toBe(false);
  });

  test('hasRole', () => {
    expect(conditions.hasRole('carrier')(baseInput)).toBe(true);
    expect(conditions.hasRole('consignee')(baseInput)).toBe(false);
  });

  test('resourceTagEquals', () => {
    expect(conditions.resourceTagEquals('visibility', 'shared')(baseInput)).toBe(true);
    expect(conditions.resourceTagEquals('visibility', 'private')(baseInput)).toBe(false);
    // when tags is undefined
    const notagged: PdpInput = {
      ...baseInput,
      resource: { ...baseInput.resource, tags: undefined },
    };
    expect(conditions.resourceTagEquals('visibility', 'shared')(notagged)).toBe(false);
  });

  test('and / or / not', () => {
    const truthy = () => true;
    const falsy = () => false;
    expect(conditions.and(truthy, truthy)(baseInput)).toBe(true);
    expect(conditions.and(truthy, falsy)(baseInput)).toBe(false);
    expect(conditions.or(falsy, truthy)(baseInput)).toBe(true);
    expect(conditions.or(falsy, falsy)(baseInput)).toBe(false);
    expect(conditions.not(falsy)(baseInput)).toBe(true);
    expect(conditions.not(truthy)(baseInput)).toBe(false);
  });
});
