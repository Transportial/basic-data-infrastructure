// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { HotConfig } from '../src/hot-reload.ts';
import { materialiseSecretFiles, type FileReader } from '../src/secret-file.ts';

describe('HotConfig', () => {
  test('current returns initial value', () => {
    const c = new HotConfig({ x: 1 }, async () => ({ x: 2 }));
    expect(c.current()).toEqual({ x: 1 });
  });

  test('reload swaps + notifies subscribers', async () => {
    const c = new HotConfig({ x: 1 }, async () => ({ x: 2 }));
    const seen: Array<{ x: number }> = [];
    c.subscribe((v) => seen.push(v));
    await c.reload();
    expect(c.current()).toEqual({ x: 2 });
    expect(seen).toEqual([{ x: 2 }]);
  });

  test('unsubscribe stops deliveries', async () => {
    const c = new HotConfig({ x: 1 }, async () => ({ x: 2 }));
    const seen: Array<{ x: number }> = [];
    const unsub = c.subscribe((v) => seen.push(v));
    unsub();
    await c.reload();
    expect(seen).toHaveLength(0);
  });

  test('dispose clears listeners and detaches', () => {
    const c = new HotConfig({ x: 1 }, async () => ({ x: 2 }));
    c.subscribe(() => {});
    c.dispose();
    // dispose is idempotent
    c.dispose();
  });

  test('bindToSignal attaches a handler (smoke)', () => {
    const c = new HotConfig({ x: 1 }, async () => ({ x: 2 }));
    c.bindToSignal('SIGUSR1');
    c.dispose();
  });

  test('reload error surfaces via awaited reload call', async () => {
    const c = new HotConfig({ x: 1 }, async () => {
      throw new Error('read failed');
    });
    await expect(c.reload()).rejects.toThrow('read failed');
  });
});

describe('materialiseSecretFiles', () => {
  const reader: FileReader = {
    readFileString(path: string): string {
      if (path === '/run/secrets/db') return 'super-secret';
      if (path === '/run/secrets/token') return 'tk-abc';
      throw new Error(`missing: ${path}`);
    },
  };

  test('replaces value from file when _FILE set', () => {
    const out = materialiseSecretFiles({ DATABASE_URL_FILE: '/run/secrets/db' }, reader);
    expect(out.DATABASE_URL).toBe('super-secret');
  });

  test('_FILE wins over explicit value', () => {
    const out = materialiseSecretFiles(
      { DATABASE_URL: 'plain', DATABASE_URL_FILE: '/run/secrets/db' },
      reader,
    );
    expect(out.DATABASE_URL).toBe('super-secret');
  });

  test('leaves non-_FILE vars alone', () => {
    const out = materialiseSecretFiles({ PORT: '8080' }, reader);
    expect(out.PORT).toBe('8080');
  });

  test('skips empty _FILE values', () => {
    const out = materialiseSecretFiles({ TOKEN_FILE: '' }, reader);
    expect(out.TOKEN).toBeUndefined();
  });

  test('multiple _FILE values all materialised', () => {
    const out = materialiseSecretFiles(
      { DATABASE_URL_FILE: '/run/secrets/db', TOKEN_FILE: '/run/secrets/token' },
      reader,
    );
    expect(out.DATABASE_URL).toBe('super-secret');
    expect(out.TOKEN).toBe('tk-abc');
  });

  test('missing file throws', () => {
    expect(() =>
      materialiseSecretFiles({ DATABASE_URL_FILE: '/nope' }, reader),
    ).toThrow();
  });
});
