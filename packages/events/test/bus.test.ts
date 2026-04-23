// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { EnvelopeProducer, InMemoryEventSink } from '../src/bus.ts';

function mkProducer(sink: InMemoryEventSink, instance = 'h1') {
  let counter = 0;
  return new EnvelopeProducer(sink, {
    service: 'asr',
    instance,
    version: '0.1.0',
    nowIso: () => '2026-04-23T10:00:00.000Z',
    nextId: () => `evt-${++counter}`,
    currentTrace: () => ({ trace_id: 'tid', span_id: 'sid' }),
  });
}

describe('EnvelopeProducer', () => {
  test('writes envelope with producer fields', async () => {
    const sink = new InMemoryEventSink();
    const producer = mkProducer(sink);
    const id = await producer.publish('asr.member.activated', 'ctn', { euid: 'NL.NHR.1' });
    expect(id).toBe('evt-1');
    expect(sink.envelopes).toHaveLength(1);
    const env = sink.envelopes[0]!;
    expect(env.type).toBe('asr.member.activated');
    expect(env.producer.service).toBe('asr');
    expect(env.schema_version).toBe(1);
    expect(env.association_id).toBe('ctn');
    expect(env.trace.trace_id).toBe('tid');
  });

  test('increments id per publish', async () => {
    const sink = new InMemoryEventSink();
    const producer = mkProducer(sink);
    const a = await producer.publish('x', 'ctn', {});
    const b = await producer.publish('x', 'ctn', {});
    expect(a).not.toBe(b);
  });
});

describe('InMemoryEventSink', () => {
  test('byType filters', async () => {
    const sink = new InMemoryEventSink();
    const producer = mkProducer(sink);
    await producer.publish('t1', 'ctn', {});
    await producer.publish('t2', 'ctn', {});
    await producer.publish('t1', 'ctn', {});
    expect(sink.byType('t1')).toHaveLength(2);
    expect(sink.byType('t2')).toHaveLength(1);
  });

  test('clear empties', async () => {
    const sink = new InMemoryEventSink();
    const producer = mkProducer(sink);
    await producer.publish('t', 'ctn', {});
    sink.clear();
    expect(sink.envelopes).toHaveLength(0);
  });
});
