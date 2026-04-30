// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { OtmPayloadInspector, OTM_CONTENT_TYPE } from '../src/inspector.ts';

describe('OtmPayloadInspector.matches', () => {
  test('matches POST with vendor content type', () => {
    const i = new OtmPayloadInspector();
    expect(
      i.matches({ method: 'POST', path: '/anything', contentType: OTM_CONTENT_TYPE, body: '' }),
    ).toBe(true);
  });

  test('matches with charset suffix', () => {
    const i = new OtmPayloadInspector();
    expect(
      i.matches({
        method: 'POST',
        path: '/x',
        contentType: `${OTM_CONTENT_TYPE}; charset=utf-8`,
        body: '',
      }),
    ).toBe(true);
  });

  test('does not match GET', () => {
    const i = new OtmPayloadInspector();
    expect(
      i.matches({ method: 'GET', path: '/x', contentType: OTM_CONTENT_TYPE, body: '' }),
    ).toBe(false);
  });

  test('matches application/json on configured prefix', () => {
    const i = new OtmPayloadInspector({ pathPrefixes: ['/otm'] });
    expect(
      i.matches({ method: 'POST', path: '/otm/consignments', contentType: 'application/json', body: '' }),
    ).toBe(true);
    expect(
      i.matches({ method: 'POST', path: '/other', contentType: 'application/json', body: '' }),
    ).toBe(false);
  });
});

describe('OtmPayloadInspector.inspect', () => {
  test('extracts entity tags on a valid payload', async () => {
    const i = new OtmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: OTM_CONTENT_TYPE,
      body: JSON.stringify({ id: 'cn-42', entityType: 'consignment' }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags).toEqual({
        'otm.version': '5.8',
        'otm.entityType': 'consignment',
        'otm.id': 'cn-42',
      });
    }
  });

  test('returns parse error on malformed json', async () => {
    const i = new OtmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: OTM_CONTENT_TYPE,
      body: '{not-json',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('otm-json-parse-failed');
  });

  test('returns validation errors with details', async () => {
    const i = new OtmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: OTM_CONTENT_TYPE,
      body: JSON.stringify({ id: 'a-1', entityType: 'actionEvent' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('otm-validation-failed');
      expect((r.details ?? []).some((d) => d.includes('lifecycle'))).toBe(true);
    }
  });
});
