// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MinimalFhirR5Validator } from '../src/validator.ts';

describe('MinimalFhirR5Validator', () => {
  const v = new MinimalFhirR5Validator();

  test('accepts a Patient without id (server-assigned)', () => {
    const r = v.validate({ resourceType: 'Patient' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceType).toBe('Patient');
      expect(r.id).toBeUndefined();
    }
  });

  test('accepts a ServiceRequest referral', () => {
    const r = v.validate({
      resourceType: 'ServiceRequest',
      id: 'sr-1',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/p-1' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceType).toBe('ServiceRequest');
      expect(r.id).toBe('sr-1');
    }
  });

  test('accepts an IPS Composition', () => {
    const r = v.validate({
      resourceType: 'Composition',
      id: 'ips-1',
      status: 'final',
      type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
      subject: { reference: 'Patient/p-1' },
      date: '2026-04-30T10:00:00Z',
      author: [{ reference: 'Practitioner/pr-1' }],
    });
    expect(r.ok).toBe(true);
  });

  test('rejects unknown resourceType', () => {
    const r = v.validate({ resourceType: 'BatchInfo' });
    expect(r.ok).toBe(false);
  });

  test('rejects malformed id', () => {
    const r = v.validate({ resourceType: 'Patient', id: 'bad id with spaces' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('FHIR id pattern'))).toBe(true);
  });

  test('rejects non-object payload', () => {
    expect(v.validate(null).ok).toBe(false);
    expect(v.validate('string').ok).toBe(false);
    expect(v.validate([]).ok).toBe(false);
  });

  test('flags missing per-resource required fields', () => {
    const r = v.validate({ resourceType: 'ServiceRequest', status: 'active' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('intent'))).toBe(true);
      expect(r.errors.some((e) => e.includes('subject'))).toBe(true);
    }
  });

  test('flags Bundle missing type', () => {
    const r = v.validate({ resourceType: 'Bundle' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('type'))).toBe(true);
  });

  test('reports validator version 5.0.0', () => {
    expect(v.version).toBe('5.0.0');
  });
});
