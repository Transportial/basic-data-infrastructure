// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export interface LogFields {
  readonly [k: string]: unknown;
}

export interface Logger {
  readonly level: LogLevel;
  child(fields: LogFields): Logger;
  trace(fields: LogFields | string, msg?: string): void;
  debug(fields: LogFields | string, msg?: string): void;
  info(fields: LogFields | string, msg?: string): void;
  warn(fields: LogFields | string, msg?: string): void;
  error(fields: LogFields | string, msg?: string): void;
}

export type LogEntry = {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly service?: string;
  readonly [k: string]: unknown;
};

export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly service?: string;
  readonly base?: LogFields;
  readonly sink?: LogSink;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base: LogFields = { ...(options.service ? { service: options.service } : {}), ...options.base };
  const sink: LogSink =
    options.sink ??
    ((entry) => {
      // stdout in production; stderr for warn/error to keep them separable
      const line = JSON.stringify(entry);
      if (entry.level === 'error' || entry.level === 'warn') {
        // eslint-disable-next-line no-console
        console.error(line);
      } else {
        // eslint-disable-next-line no-console
        console.log(line);
      }
    });

  function log(lvl: LogLevel, a: LogFields | string, b?: string): void {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const fields: LogFields = typeof a === 'string' ? {} : a;
    const msg = typeof a === 'string' ? a : (b ?? '');
    sink({
      time: new Date().toISOString(),
      level: lvl,
      msg,
      ...base,
      ...fields,
    });
  }

  return {
    level,
    child(extra: LogFields): Logger {
      return createLogger({
        level,
        base: { ...base, ...extra },
        sink,
      });
    },
    trace: (a, b) => log('trace', a, b),
    debug: (a, b) => log('debug', a, b),
    info: (a, b) => log('info', a, b),
    warn: (a, b) => log('warn', a, b),
    error: (a, b) => log('error', a, b),
  };
}

export function createMemorySink(): { sink: LogSink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (e) => void entries.push(e),
  };
}
