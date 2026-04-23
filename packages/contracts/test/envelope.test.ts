// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
import { describe, test, expect } from 'bun:test';
import { ok, err } from '@bdi/kernel';
import {
  validateEnvelope,
  AsrEventTypes,
  OrsEventTypes,
  ConEventTypes,
} from '../src/events/envelope.ts';

const base = {
  id: 'ulid-1',
  occurred_at: '2026-04-23T00:00:00Z',
  producer: { service: 'asr', instance: 'host-1', version: '0.1.0' },
  association_id: 'ctn',
  type: 'asr.member.activated',
  schema_version: 1,
  trace: { trace_id: 'abc', span_id: 'def' },
  body: { euid: 'NL.NHR.12345678' },
};

describe('validateEnvelope', () => {
  test('accepts valid envelope', () => {
    expect(validateEnvelope(base).ok).toBe(true);
  });

  test('rejects non-object', () => {
    expect(validateEnvelope(null).ok).toBe(false);
  });

  test('rejects missing body', () => {
    expect(validateEnvelope({ ...base, body: undefined }).ok).toBe(false);
  });

  test('rejects bad producer', () => {
    const r = validateEnvelope({ ...base, producer: { service: 'xyz', instance: 1, version: 1 } });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-object producer', () => {
    const r = validateEnvelope({ ...base, producer: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-object trace', () => {
    const r = validateEnvelope({ ...base, trace: 'x' });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad trace fields', () => {
    const r = validateEnvelope({ ...base, trace: { trace_id: 1, span_id: 2 } });
    expect(!r.ok).toBe(true);
  });

  test('rejects non-1 schema version', () => {
    const r = validateEnvelope({ ...base, schema_version: 2 });
    expect(!r.ok).toBe(true);
  });

  test('rejects bad primitive fields', () => {
    const r = validateEnvelope({
      ...base,
      id: 1,
      occurred_at: 1,
      association_id: 1,
      type: 1,
    });
    expect(!r.ok).toBe(true);
  });

  test('runs body validator when provided', () => {
    const r = validateEnvelope(base, (b) => {
      if (typeof (b as { euid: string }).euid === 'string') return ok(b as { euid: string });
      return err([{ path: [], reason: 'bad' }]);
    });
    expect(r.ok).toBe(true);
  });

  test('body validator errors are prefixed with body path', () => {
    const r = validateEnvelope(base, () => err([{ path: ['euid'], reason: 'bad' }]));
    expect(!r.ok && r.error[0]?.path).toEqual(['body', 'euid']);
  });
});

describe('event type constants', () => {
  test('ASR types are namespaced', () => {
    expect(AsrEventTypes.MEMBER_ACTIVATED).toBe('asr.member.activated');
  });
  test('ORS types are namespaced', () => {
    expect(OrsEventTypes.CONTEXT_CREATED).toBe('ors.context.created');
  });
  test('CON types are namespaced', () => {
    expect(ConEventTypes.WEBHOOK_DELIVERED).toBe('con.webhook.delivered');
  });
});
