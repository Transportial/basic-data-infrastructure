// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MinimalEftiValidator } from '../src/validator.ts';

describe('MinimalEftiValidator', () => {
  const v = new MinimalEftiValidator();

  test('accepts a minimal consignment with sender + consignee', () => {
    const r = v.validate({
      id: 'c-1',
      eftiType: 'consignment',
      senderParty: { id: 'p-1' },
      consigneeParty: { id: 'p-2' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entityType).toBe('consignment');
      expect(r.id).toBe('c-1');
    }
  });

  test('rejects unknown eftiType', () => {
    const r = v.validate({ id: 'x', eftiType: 'shipment' });
    expect(r.ok).toBe(false);
  });

  test('rejects missing id', () => {
    const r = v.validate({ eftiType: 'goodsItem' });
    expect(r.ok).toBe(false);
  });

  test('rejects empty id', () => {
    const r = v.validate({ id: '', eftiType: 'goodsItem' });
    expect(r.ok).toBe(false);
  });

  test('rejects non-object payload', () => {
    expect(v.validate(null).ok).toBe(false);
    expect(v.validate('string').ok).toBe(false);
    expect(v.validate([]).ok).toBe(false);
  });

  test('flags missing per-entity required fields', () => {
    const r = v.validate({ id: 'e-1', eftiType: 'transportEvent' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('occurrenceDateTime'))).toBe(true);
  });

  test('flags missing UN number for dangerous goods', () => {
    const r = v.validate({ id: 'd-1', eftiType: 'dangerousGoods' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('unNumber'))).toBe(true);
  });

  test('reports validator version 1.0.0', () => {
    expect(v.version).toBe('1.0.0');
  });
});
