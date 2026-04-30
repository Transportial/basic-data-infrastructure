// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { EftiPayloadInspector, EFTI_CONTENT_TYPE } from '../src/inspector.ts';

describe('EftiPayloadInspector.matches', () => {
  test('matches POST with vendor content type', () => {
    const i = new EftiPayloadInspector();
    expect(
      i.matches({ method: 'POST', path: '/anything', contentType: EFTI_CONTENT_TYPE, body: '' }),
    ).toBe(true);
  });

  test('matches with charset suffix', () => {
    const i = new EftiPayloadInspector();
    expect(
      i.matches({
        method: 'POST',
        path: '/x',
        contentType: `${EFTI_CONTENT_TYPE}; charset=utf-8`,
        body: '',
      }),
    ).toBe(true);
  });

  test('does not match GET', () => {
    const i = new EftiPayloadInspector();
    expect(
      i.matches({ method: 'GET', path: '/x', contentType: EFTI_CONTENT_TYPE, body: '' }),
    ).toBe(false);
  });

  test('matches application/json on configured prefix', () => {
    const i = new EftiPayloadInspector({ pathPrefixes: ['/efti'] });
    expect(
      i.matches({
        method: 'POST',
        path: '/efti/consignments',
        contentType: 'application/json',
        body: '',
      }),
    ).toBe(true);
    expect(
      i.matches({ method: 'POST', path: '/other', contentType: 'application/json', body: '' }),
    ).toBe(false);
  });
});

describe('EftiPayloadInspector.inspect', () => {
  test('extracts entity tags on a valid payload', async () => {
    const i = new EftiPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: EFTI_CONTENT_TYPE,
      body: JSON.stringify({
        id: 'cn-42',
        eftiType: 'consignment',
        senderParty: { id: 'p-s' },
        consigneeParty: { id: 'p-c' },
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags).toEqual({
        'efti.version': '1.0.0',
        'efti.entityType': 'consignment',
        'efti.id': 'cn-42',
      });
    }
  });

  test('returns parse error on malformed json', async () => {
    const i = new EftiPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: EFTI_CONTENT_TYPE,
      body: '{not-json',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('efti-json-parse-failed');
  });

  test('returns validation errors with details', async () => {
    const i = new EftiPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: EFTI_CONTENT_TYPE,
      body: JSON.stringify({ id: 'e-1', eftiType: 'transportEvent' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('efti-validation-failed');
      expect((r.details ?? []).some((d) => d.includes('occurrenceDateTime'))).toBe(true);
    }
  });
});
