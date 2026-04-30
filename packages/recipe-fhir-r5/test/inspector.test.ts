// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { FhirR5PayloadInspector, FHIR_CONTENT_TYPE } from '../src/inspector.ts';

describe('FhirR5PayloadInspector.matches', () => {
  test('matches POST with FHIR content type', () => {
    const i = new FhirR5PayloadInspector();
    expect(
      i.matches({ method: 'POST', path: '/Patient', contentType: FHIR_CONTENT_TYPE, body: '' }),
    ).toBe(true);
  });

  test('matches with fhirVersion parameter', () => {
    const i = new FhirR5PayloadInspector();
    expect(
      i.matches({
        method: 'POST',
        path: '/Patient',
        contentType: `${FHIR_CONTENT_TYPE}; fhirVersion=5.0`,
        body: '',
      }),
    ).toBe(true);
  });

  test('does not match GET', () => {
    const i = new FhirR5PayloadInspector();
    expect(
      i.matches({ method: 'GET', path: '/Patient', contentType: FHIR_CONTENT_TYPE, body: '' }),
    ).toBe(false);
  });

  test('matches application/json on configured prefix', () => {
    const i = new FhirR5PayloadInspector({ pathPrefixes: ['/fhir'] });
    expect(
      i.matches({
        method: 'POST',
        path: '/fhir/Patient',
        contentType: 'application/json',
        body: '',
      }),
    ).toBe(true);
    expect(
      i.matches({ method: 'POST', path: '/other', contentType: 'application/json', body: '' }),
    ).toBe(false);
  });
});

describe('FhirR5PayloadInspector.inspect', () => {
  test('extracts resource tags on a valid ServiceRequest', async () => {
    const i = new FhirR5PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/ServiceRequest',
      contentType: FHIR_CONTENT_TYPE,
      body: JSON.stringify({
        resourceType: 'ServiceRequest',
        id: 'sr-42',
        status: 'active',
        intent: 'order',
        subject: { reference: 'Patient/p-1' },
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags).toEqual({
        'fhir.version': '5.0.0',
        'fhir.resourceType': 'ServiceRequest',
        'fhir.id': 'sr-42',
      });
    }
  });

  test('omits id tag when payload has no id', async () => {
    const i = new FhirR5PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/Patient',
      contentType: FHIR_CONTENT_TYPE,
      body: JSON.stringify({ resourceType: 'Patient' }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags?.['fhir.id']).toBeUndefined();
      expect(r.resourceTags?.['fhir.resourceType']).toBe('Patient');
    }
  });

  test('returns parse error on malformed json', async () => {
    const i = new FhirR5PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/Patient',
      contentType: FHIR_CONTENT_TYPE,
      body: '{not-json',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('fhir-json-parse-failed');
  });

  test('returns validation errors with details', async () => {
    const i = new FhirR5PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/ServiceRequest',
      contentType: FHIR_CONTENT_TYPE,
      body: JSON.stringify({ resourceType: 'ServiceRequest', status: 'active' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('fhir-validation-failed');
      expect((r.details ?? []).some((d) => d.includes('intent'))).toBe(true);
    }
  });
});
