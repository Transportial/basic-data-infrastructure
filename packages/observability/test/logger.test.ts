// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect, spyOn } from 'bun:test';
import { createLogger, createMemorySink } from '../src/logger.ts';

describe('logger', () => {
  test('info logs with service field', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ service: 'asr', sink });
    log.info({ action: 'start' }, 'hello');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.msg).toBe('hello');
    expect(entries[0]?.service).toBe('asr');
    expect(entries[0]?.['action']).toBe('start');
  });

  test('string-only form yields empty fields', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ sink });
    log.info('simple message');
    expect(entries[0]?.msg).toBe('simple message');
  });

  test('level filtering', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ level: 'warn', sink });
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  test('child logger inherits base fields', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ service: 'ors', sink });
    const child = log.child({ reqId: 'abc' });
    child.info('hi');
    expect(entries[0]?.['reqId']).toBe('abc');
    expect(entries[0]?.service).toBe('ors');
  });

  test('child logger inherits level', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ level: 'error', sink });
    const child = log.child({ k: 1 });
    child.info('nope');
    child.error('yes');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('yes');
  });

  test('level property is exposed', () => {
    const log = createLogger({ level: 'debug', sink: () => {} });
    expect(log.level).toBe('debug');
  });

  test('default sink writes to stdout/stderr', () => {
    const outSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger({ level: 'trace' });
    log.info('infoline');
    log.warn('warnline');
    log.error('errline');
    expect(outSpy).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(2);
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('default level is info', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ sink });
    log.debug('nope');
    log.info('yes');
    expect(entries).toHaveLength(1);
  });

  test('trace, debug methods emit at their levels', () => {
    const { sink, entries } = createMemorySink();
    const log = createLogger({ level: 'trace', sink });
    log.trace({ a: 1 }, 'tr');
    log.debug({ a: 2 }, 'de');
    expect(entries.map((e) => e.level)).toEqual(['trace', 'debug']);
  });
});
