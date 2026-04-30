// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { Pacs008PayloadInspector, ISO20022_CONTENT_TYPE } from '../src/inspector.ts';

const validPayload = {
  Document: {
    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: 'M-42',
        CreDtTm: '2026-04-30T10:00:00Z',
        NbOfTxs: '1',
        SttlmInf: { SttlmMtd: 'CLRG' },
      },
      CdtTrfTxInf: {
        PmtId: { EndToEndId: 'E2E-9' },
        IntrBkSttlmAmt: { '@Ccy': 'EUR', '#': '50.00' },
        ChrgBr: 'SHAR',
        Dbtr: { Nm: 'Acme BV' },
        DbtrAgt: { FinInstnId: { BICFI: 'ABNANL2A' } },
        Cdtr: { Nm: 'Beta NV' },
        CdtrAgt: { FinInstnId: { BICFI: 'INGBNL2A' } },
      },
    },
  },
};

describe('Pacs008PayloadInspector.matches', () => {
  test('matches POST with vendor content type', () => {
    const i = new Pacs008PayloadInspector();
    expect(
      i.matches({ method: 'POST', path: '/payments', contentType: ISO20022_CONTENT_TYPE, body: '' }),
    ).toBe(true);
  });

  test('matches with charset suffix', () => {
    const i = new Pacs008PayloadInspector();
    expect(
      i.matches({
        method: 'POST',
        path: '/x',
        contentType: `${ISO20022_CONTENT_TYPE}; charset=utf-8`,
        body: '',
      }),
    ).toBe(true);
  });

  test('does not match GET', () => {
    const i = new Pacs008PayloadInspector();
    expect(
      i.matches({ method: 'GET', path: '/x', contentType: ISO20022_CONTENT_TYPE, body: '' }),
    ).toBe(false);
  });

  test('matches application/json on configured prefix', () => {
    const i = new Pacs008PayloadInspector({ pathPrefixes: ['/iso20022'] });
    expect(
      i.matches({
        method: 'POST',
        path: '/iso20022/pacs008',
        contentType: 'application/json',
        body: '',
      }),
    ).toBe(true);
    expect(
      i.matches({ method: 'POST', path: '/other', contentType: 'application/json', body: '' }),
    ).toBe(false);
  });
});

describe('Pacs008PayloadInspector.inspect', () => {
  test('extracts settlement tags on a valid payload', async () => {
    const i = new Pacs008PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/payments',
      contentType: ISO20022_CONTENT_TYPE,
      body: JSON.stringify(validPayload),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceTags).toEqual({
        'iso20022.message': 'pacs.008.001.10',
        'iso20022.msgId': 'M-42',
        'iso20022.txCount': '1',
        'iso20022.endToEndId': 'E2E-9',
      });
    }
  });

  test('returns parse error on malformed json', async () => {
    const i = new Pacs008PayloadInspector();
    const r = await i.inspect({
      method: 'POST',
      path: '/payments',
      contentType: ISO20022_CONTENT_TYPE,
      body: '{not-json',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('pacs008-json-parse-failed');
  });

  test('returns validation errors with details', async () => {
    const i = new Pacs008PayloadInspector();
    const broken = JSON.parse(JSON.stringify(validPayload));
    delete broken.Document.FIToFICstmrCdtTrf.GrpHdr.MsgId;
    const r = await i.inspect({
      method: 'POST',
      path: '/payments',
      contentType: ISO20022_CONTENT_TYPE,
      body: JSON.stringify(broken),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('pacs008-validation-failed');
      expect((r.details ?? []).some((d) => d.includes('MsgId'))).toBe(true);
    }
  });
});
