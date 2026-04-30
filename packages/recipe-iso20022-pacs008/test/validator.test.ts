// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { MinimalPacs008Validator } from '../src/validator.ts';

const minimalTx = {
  PmtId: { EndToEndId: 'E2E-1' },
  IntrBkSttlmAmt: { '@Ccy': 'EUR', '#': '100.00' },
  ChrgBr: 'SHAR',
  Dbtr: { Nm: 'Acme BV' },
  DbtrAgt: { FinInstnId: { BICFI: 'ABNANL2A' } },
  Cdtr: { Nm: 'Beta NV' },
  CdtrAgt: { FinInstnId: { BICFI: 'INGBNL2A' } },
};

const minimalEnvelope = {
  Document: {
    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: 'M-1',
        CreDtTm: '2026-04-30T10:00:00Z',
        NbOfTxs: '1',
        SttlmInf: { SttlmMtd: 'CLRG' },
      },
      CdtTrfTxInf: minimalTx,
    },
  },
};

describe('MinimalPacs008Validator', () => {
  const v = new MinimalPacs008Validator();

  test('accepts a single-transaction envelope', () => {
    const r = v.validate(minimalEnvelope);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.messageDefinition).toBe('pacs.008.001.10');
      expect(r.msgId).toBe('M-1');
      expect(r.txCount).toBe(1);
      expect(r.firstEndToEndId).toBe('E2E-1');
    }
  });

  test('accepts a multi-transaction envelope', () => {
    const env = structuredClone(minimalEnvelope);
    env.Document.FIToFICstmrCdtTrf.CdtTrfTxInf = [minimalTx, minimalTx, minimalTx] as never;
    const r = v.validate(env);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.txCount).toBe(3);
  });

  test('rejects payload missing Document', () => {
    const r = v.validate({ FIToFICstmrCdtTrf: {} });
    expect(r.ok).toBe(false);
  });

  test('rejects payload missing FIToFICstmrCdtTrf', () => {
    const r = v.validate({ Document: {} });
    expect(r.ok).toBe(false);
  });

  test('rejects empty CdtTrfTxInf array', () => {
    const env = structuredClone(minimalEnvelope);
    env.Document.FIToFICstmrCdtTrf.CdtTrfTxInf = [] as never;
    const r = v.validate(env);
    expect(r.ok).toBe(false);
  });

  test('flags missing GrpHdr fields', () => {
    const env = structuredClone(minimalEnvelope);
    delete (env.Document.FIToFICstmrCdtTrf.GrpHdr as Record<string, unknown>)['MsgId'];
    const r = v.validate(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('MsgId'))).toBe(true);
  });

  test('flags missing transaction fields', () => {
    const env = structuredClone(minimalEnvelope);
    delete (env.Document.FIToFICstmrCdtTrf.CdtTrfTxInf as Record<string, unknown>)['Cdtr'];
    const r = v.validate(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('Cdtr'))).toBe(true);
  });

  test('rejects non-object payload', () => {
    expect(v.validate(null).ok).toBe(false);
    expect(v.validate('string').ok).toBe(false);
    expect(v.validate([]).ok).toBe(false);
  });

  test('reports message definition pacs.008.001.10', () => {
    expect(v.messageDefinition).toBe('pacs.008.001.10');
  });
});
