// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { parseAssociationId, parseEuid } from '@bdi/kernel';
import { createDraftMember, type SigningRepresentative } from '../../src/domain/model/member.ts';
import {
  activate,
  computeAssuranceLevel,
  isOperational,
  markVerified,
  recordVerification,
  reinstate,
  revoke,
  suspend,
} from '../../src/domain/model/member-transitions.ts';

const euid = parseEuid('NL.NHR.12345678');
if (!euid.ok) throw new Error('bad fixture');
const assoc = parseAssociationId('ctn');
if (!assoc.ok) throw new Error('bad fixture');

const rep: SigningRepresentative = {
  subject_id: 'subj-1',
  auth_source: 'eHerkenning',
  assurance: 'high',
  verified_at: '2026-04-01T00:00:00Z',
};

function draft(opts?: { withRep?: boolean }) {
  return createDraftMember({
    id: 'm-1',
    association_id: assoc.value,
    euid: euid.value,
    legal_name: 'Acme BV',
    signing_representative: opts?.withRep === false ? null : rep,
    created_at: '2026-04-23T00:00:00Z',
  });
}

describe('createDraftMember', () => {
  test('defaults', () => {
    const m = draft();
    expect(m.status).toBe('draft');
    expect(m.verifications).toEqual([]);
    expect(m.assurance_level).toBeNull();
    expect(m.votes_in_association).toBe(false);
  });

  test('keeps provided vat and lei', () => {
    const m = createDraftMember({
      id: 'm-2',
      association_id: assoc.value,
      euid: euid.value,
      legal_name: 'Acme',
      signing_representative: null,
      created_at: '2026-04-01T00:00:00Z',
      vat_number: 'NL123',
      lei: 'HWUPKR0MPOU8FGXBT394',
    });
    expect(m.vat_number).toBe('NL123');
    expect(m.lei).toBe('HWUPKR0MPOU8FGXBT394');
  });
});

describe('recordVerification', () => {
  test('appends without mutating', () => {
    const m = draft();
    const after = recordVerification(m, {
      source: 'KvK',
      outcome: 'success',
      verified_at: '2026-04-23T10:00:00Z',
      evidence_hash: 'h',
    });
    expect(m.verifications).toHaveLength(0);
    expect(after.verifications).toHaveLength(1);
  });
});

describe('computeAssuranceLevel', () => {
  test('null when no successes', () => {
    expect(computeAssuranceLevel([])).toBeNull();
    expect(
      computeAssuranceLevel([
        { source: 'KvK', outcome: 'failure', verified_at: '', evidence_hash: '' },
      ]),
    ).toBeNull();
  });

  test('substantial on a single registry success', () => {
    expect(
      computeAssuranceLevel([
        { source: 'KvK', outcome: 'success', verified_at: '', evidence_hash: '' },
      ]),
    ).toBe('substantial');
  });

  test('high on two registry successes', () => {
    expect(
      computeAssuranceLevel([
        { source: 'KvK', outcome: 'success', verified_at: '', evidence_hash: '' },
        { source: 'VIES', outcome: 'success', verified_at: '', evidence_hash: '' },
      ]),
    ).toBe('high');
  });

  test('high on eHerkenning', () => {
    expect(
      computeAssuranceLevel([
        { source: 'eHerkenning', outcome: 'success', verified_at: '', evidence_hash: '' },
      ]),
    ).toBe('high');
  });
});

describe('markVerified', () => {
  test('draft + verifications → verified', () => {
    const m = recordVerification(draft(), {
      source: 'KvK',
      outcome: 'success',
      verified_at: 'x',
      evidence_hash: 'h',
    });
    const r = markVerified(m, '2026-04-23T00:00:00Z');
    expect(r.ok && r.value.status).toBe('verified');
    expect(r.ok && r.value.assurance_level).toBe('substantial');
  });

  test('rejects when not draft', () => {
    const m = { ...draft(), status: 'activated' as const };
    const r = markVerified(m, '2026-04-23T00:00:00Z');
    expect(!r.ok && r.error.type).toBe('invalid-transition');
  });

  test('rejects when no verifications', () => {
    const r = markVerified(draft(), '2026-04-23T00:00:00Z');
    expect(!r.ok && r.error.type).toBe('no-verifications');
  });
});

describe('activate', () => {
  test('verified + rep → activated', () => {
    let m = recordVerification(draft(), {
      source: 'KvK',
      outcome: 'success',
      verified_at: 'x',
      evidence_hash: 'h',
    });
    const verified = markVerified(m, 'x');
    if (!verified.ok) throw new Error('setup');
    m = verified.value;
    const r = activate(m, '2026-04-23T00:00:00Z');
    expect(r.ok && r.value.status).toBe('activated');
    expect(r.ok && r.value.activated_at).toBe('2026-04-23T00:00:00Z');
  });

  test('not-verified → invalid-transition', () => {
    const r = activate(draft(), 'x');
    expect(!r.ok && r.error.type).toBe('invalid-transition');
  });

  test('missing rep → missing-signing-representative', () => {
    let m = recordVerification(draft({ withRep: false }), {
      source: 'KvK',
      outcome: 'success',
      verified_at: 'x',
      evidence_hash: 'h',
    });
    const verified = markVerified(m, 'x');
    if (!verified.ok) throw new Error('setup');
    m = verified.value;
    const r = activate(m, 'x');
    expect(!r.ok && r.error.type).toBe('missing-signing-representative');
  });
});

describe('suspend / reinstate / revoke', () => {
  function activatedMember() {
    let m = recordVerification(draft(), {
      source: 'KvK',
      outcome: 'success',
      verified_at: 'x',
      evidence_hash: 'h',
    });
    const v = markVerified(m, 'x');
    if (!v.ok) throw new Error('setup');
    m = v.value;
    const a = activate(m, 'now');
    if (!a.ok) throw new Error('setup');
    return a.value;
  }

  test('suspend of activated → suspended', () => {
    const r = suspend(activatedMember(), 'now');
    expect(r.ok && r.value.status).toBe('suspended');
  });

  test('suspend of non-activated fails', () => {
    const r = suspend(draft(), 'now');
    expect(!r.ok && r.error.type).toBe('invalid-transition');
  });

  test('reinstate of suspended → activated', () => {
    const sus = suspend(activatedMember(), 'now');
    if (!sus.ok) throw new Error('setup');
    const r = reinstate(sus.value);
    expect(r.ok && r.value.status).toBe('activated');
    expect(r.ok && r.value.suspended_at).toBeNull();
  });

  test('reinstate of non-suspended fails', () => {
    const r = reinstate(draft());
    expect(!r.ok && r.error.type).toBe('invalid-transition');
  });

  test('revoke of activated → revoked', () => {
    const r = revoke(activatedMember(), 'now');
    expect(r.ok && r.value.status).toBe('revoked');
  });

  test('revoke of suspended → revoked', () => {
    const sus = suspend(activatedMember(), 'now');
    if (!sus.ok) throw new Error('setup');
    const r = revoke(sus.value, 'now');
    expect(r.ok && r.value.status).toBe('revoked');
  });

  test('revoke of draft fails', () => {
    const r = revoke(draft(), 'now');
    expect(!r.ok && r.error.type).toBe('invalid-transition');
  });

  test('revoke of revoked fails', () => {
    const rev = revoke(activatedMember(), 'now');
    if (!rev.ok) throw new Error('setup');
    const r = revoke(rev.value, 'now');
    expect(!r.ok).toBe(true);
  });
});

describe('isOperational', () => {
  test('true only for activated', () => {
    const d = draft();
    expect(isOperational(d)).toBe(false);
    expect(isOperational({ ...d, status: 'activated' })).toBe(true);
  });
});
