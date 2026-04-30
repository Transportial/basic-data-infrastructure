// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MmtRsmPayloadInspector, MMT_RSM_CONTENT_TYPE } from '../src/inspector.ts';

describe('MmtRsmPayloadInspector.matches', () => {
  test('matches POST with vendor content type', () => {
    const i = new MmtRsmPayloadInspector();
    expect(
      i.matches({ method: 'POST', path: '/anything', contentType: MMT_RSM_CONTENT_TYPE, body: '' }),
    ).toBe(true);
  });

  test('matches with charset suffix', () => {
    const i = new MmtRsmPayloadInspector();
    expect(
      i.matches({
        method: 'POST',
        path: '/x',
        contentType: `${MMT_RSM_CONTENT_TYPE}; charset=utf-8`,
        body: '',
      }),
    ).toBe(true);
  });

  test('does not match GET', () => {
    const i = new MmtRsmPayloadInspector();
    expect(
      i.matches({ method: 'GET', path: '/x', contentType: MMT_RSM_CONTENT_TYPE, body: '' }),
    ).toBe(false);
  });

  test('matches application/json on configured prefix', () => {
    const i = new MmtRsmPayloadInspector({ pathPrefixes: ['/customs'] });
    expect(
      i.matches({
        method: 'POST',
        path: '/customs/declarations',
        contentType: 'application/json',
        body: '',
      }),
    ).toBe(true);
    expect(
      i.matches({ method: 'POST', path: '/other', contentType: 'application/json', body: '' }),
    ).toBe(false);
  });
});

describe('MmtRsmPayloadInspector.inspect', () => {
  test('extracts entity tags on a valid payload', async () => {
    const i = new MmtRsmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: MMT_RSM_CONTENT_TYPE,
      body: JSON.stringify({
        id: 'cn-42',
        entityType: 'consignment',
        consignor: { id: 'p-s' },
        consignee: { id: 'p-c' },
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags).toEqual({
        'mmt-rsm.version': '1.0.0',
        'mmt-rsm.entityType': 'consignment',
        'mmt-rsm.id': 'cn-42',
      });
    }
  });

  test('returns parse error on malformed json', async () => {
    const i = new MmtRsmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: MMT_RSM_CONTENT_TYPE,
      body: '{not-json',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mmt-rsm-json-parse-failed');
  });

  test('returns validation errors with details', async () => {
    const i = new MmtRsmPayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/x',
      contentType: MMT_RSM_CONTENT_TYPE,
      body: JSON.stringify({ id: 'cd-1', entityType: 'customsDeclaration' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('mmt-rsm-validation-failed');
      expect((r.details ?? []).some((d) => d.includes('declarationType'))).toBe(true);
    }
  });
});
