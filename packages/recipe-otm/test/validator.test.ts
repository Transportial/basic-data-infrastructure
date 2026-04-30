// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MinimalOtmValidator } from '../src/validator.ts';

describe('MinimalOtmValidator', () => {
  const v = new MinimalOtmValidator();

  test('accepts a minimal consignment', () => {
    const r = v.validate({ id: 'c-1', entityType: 'consignment' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entityType).toBe('consignment');
      expect(r.id).toBe('c-1');
    }
  });

  test('rejects unknown entityType', () => {
    const r = v.validate({ id: 'x', entityType: 'shipment' });
    expect(r.ok).toBe(false);
  });

  test('rejects missing id', () => {
    const r = v.validate({ entityType: 'consignment' });
    expect(r.ok).toBe(false);
  });

  test('rejects empty id', () => {
    const r = v.validate({ id: '', entityType: 'consignment' });
    expect(r.ok).toBe(false);
  });

  test('rejects non-object payload', () => {
    expect(v.validate(null).ok).toBe(false);
    expect(v.validate('string').ok).toBe(false);
    expect(v.validate([]).ok).toBe(false);
  });

  test('flags missing per-entity required fields', () => {
    const r = v.validate({ id: 'a-1', entityType: 'actionEvent' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('lifecycle'))).toBe(true);
  });

  test('reports validator version 5.8', () => {
    expect(v.version).toBe('5.8');
  });
});
