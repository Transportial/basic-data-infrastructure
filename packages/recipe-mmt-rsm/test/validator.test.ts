// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MinimalMmtRsmValidator } from '../src/validator.ts';

describe('MinimalMmtRsmValidator', () => {
  const v = new MinimalMmtRsmValidator();

  test('accepts a minimal consignment', () => {
    const r = v.validate({
      id: 'c-1',
      entityType: 'consignment',
      consignor: { id: 'p-1' },
      consignee: { id: 'p-2' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entityType).toBe('consignment');
      expect(r.id).toBe('c-1');
    }
  });

  test('accepts a transport movement', () => {
    const r = v.validate({
      id: 'tm-1',
      entityType: 'transportMovement',
      departureLocation: { id: 'l-1' },
      arrivalLocation: { id: 'l-2' },
    });
    expect(r.ok).toBe(true);
  });

  test('rejects unknown entityType', () => {
    const r = v.validate({ id: 'x', entityType: 'shipment' });
    expect(r.ok).toBe(false);
  });

  test('rejects missing id', () => {
    const r = v.validate({ entityType: 'goodsItem', description: 'pallet' });
    expect(r.ok).toBe(false);
  });

  test('rejects empty id', () => {
    const r = v.validate({ id: '', entityType: 'goodsItem', description: 'pallet' });
    expect(r.ok).toBe(false);
  });

  test('rejects non-object payload', () => {
    expect(v.validate(null).ok).toBe(false);
    expect(v.validate('string').ok).toBe(false);
    expect(v.validate([]).ok).toBe(false);
  });

  test('flags missing per-entity required fields', () => {
    const r = v.validate({ id: 'cd-1', entityType: 'customsDeclaration' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('declarationType'))).toBe(true);
      expect(r.errors.some((e) => e.includes('declarant'))).toBe(true);
    }
  });

  test('reports validator version 1.0.0', () => {
    expect(v.version).toBe('1.0.0');
  });
});
