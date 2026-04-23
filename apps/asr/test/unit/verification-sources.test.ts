// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { parseEuid } from '@bdi/kernel';
import {
  KboVerificationSource,
  KvkVerificationSource,
  GleifVerificationSource,
  SystemFetcher,
  ViesVerificationSource,
  sha256Hex,
  type Fetcher,
} from '../../src/infrastructure/verification-sources.ts';

const euid = parseEuid('NL.NHR.12345678');
if (!euid.ok) throw new Error('setup');
const beEuid = parseEuid('BE.KBO.0400378485');
if (!beEuid.ok) throw new Error('setup');

class MockFetcher implements Fetcher {
  lastCall: { url: string; init?: RequestInit } | null = null;
  constructor(
    private readonly handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ) {}
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    this.lastCall = { url, ...(init !== undefined ? { init } : {}) };
    return this.handler(url, init);
  }
}

describe('SystemFetcher', () => {
  test('delegates to global fetch', () => {
    const f = new SystemFetcher();
    // just ensure the method exists and is bound correctly
    expect(typeof f.fetch).toBe('function');
  });
});

describe('sha256Hex', () => {
  test('known hash', async () => {
    // sha256('abc') = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('KvkVerificationSource', () => {
  test('success when name matches', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ naam: 'Acme BV' }), { status: 200 }),
    );
    const src = new KvkVerificationSource({ baseUrl: 'https://api.kvk.nl/', apiKey: 'secret', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('success');
    expect(fetcher.lastCall?.url).toContain('/v2/basisprofielen/');
  });

  test('falls back to handelsnaam when naam missing', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ handelsnaam: 'Acme BV' }), { status: 200 }),
    );
    const src = new KvkVerificationSource({ baseUrl: 'https://api.kvk.nl', apiKey: 'k', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('success');
  });

  test('partial when name mismatches', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ naam: 'Other BV' }), { status: 200 }),
    );
    const src = new KvkVerificationSource({ baseUrl: 'https://api.kvk.nl', apiKey: 'k', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('partial');
  });

  test('partial on invalid JSON', async () => {
    const fetcher = new MockFetcher(async () => new Response('not-json', { status: 200 }));
    const src = new KvkVerificationSource({ baseUrl: 'https://api.kvk.nl', apiKey: 'k', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('partial');
  });

  test('failure on non-200', async () => {
    const fetcher = new MockFetcher(async () => new Response('forbidden', { status: 403 }));
    const src = new KvkVerificationSource({ baseUrl: 'https://api.kvk.nl', apiKey: 'k', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('failure');
  });
});

describe('ViesVerificationSource', () => {
  test('success on valid+name match', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ valid: true, name: 'Acme BV Europe' }), { status: 200 }),
    );
    const src = new ViesVerificationSource({ baseUrl: 'https://ec.europa.eu/vies', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('success');
  });

  test('partial on valid without name', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ valid: true }), { status: 200 }),
    );
    const src = new ViesVerificationSource({ baseUrl: 'https://ec.europa.eu/vies', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('partial');
  });

  test('failure on invalid=false', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ valid: false }), { status: 200 }),
    );
    const src = new ViesVerificationSource({ baseUrl: 'https://ec.europa.eu/vies', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('failure');
  });

  test('failure on invalid JSON', async () => {
    const fetcher = new MockFetcher(async () => new Response('oops', { status: 200 }));
    const src = new ViesVerificationSource({ baseUrl: 'https://ec.europa.eu/vies', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('failure');
  });

  test('failure on non-200', async () => {
    const fetcher = new MockFetcher(async () => new Response('', { status: 500 }));
    const src = new ViesVerificationSource({ baseUrl: 'https://ec.europa.eu/vies', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('failure');
  });
});

describe('GleifVerificationSource', () => {
  test('success on matching name', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(
        JSON.stringify({ data: { attributes: { entity: { legalName: { name: 'Acme BV' } } } } }),
        { status: 200 },
      ),
    );
    const src = new GleifVerificationSource({
      baseUrl: 'https://api.gleif.org/api/v1',
      lei: 'HWUPKR0MPOU8FGXBT394',
      fetcher,
    });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('success');
  });

  test('partial on name mismatch', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(
        JSON.stringify({ data: { attributes: { entity: { legalName: { name: 'Other' } } } } }),
        { status: 200 },
      ),
    );
    const src = new GleifVerificationSource({ baseUrl: 'https://api.gleif.org/api/v1', lei: 'X', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('partial');
  });

  test('partial on bad JSON', async () => {
    const fetcher = new MockFetcher(async () => new Response('oops', { status: 200 }));
    const src = new GleifVerificationSource({ baseUrl: 'https://api.gleif.org/api/v1', lei: 'X', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('partial');
  });

  test('partial on non-200', async () => {
    const fetcher = new MockFetcher(async () => new Response('', { status: 404 }));
    const src = new GleifVerificationSource({ baseUrl: 'https://api.gleif.org/api/v1', lei: 'X', fetcher });
    const r = await src.verify({ euid: euid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('partial');
  });
});

describe('KboVerificationSource', () => {
  test('success', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ name: 'Acme BV' }), { status: 200 }),
    );
    const src = new KboVerificationSource({ baseUrl: 'https://api.kbo.be', fetcher });
    const r = await src.verify({ euid: beEuid.value, legal_name: 'Acme BV' });
    expect(r.outcome).toBe('success');
  });

  test('success with apiKey sends auth header', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ name: 'Acme BV' }), { status: 200 }),
    );
    const src = new KboVerificationSource({ baseUrl: 'https://api.kbo.be', apiKey: 'secret', fetcher });
    await src.verify({ euid: beEuid.value, legal_name: 'Acme BV' });
    const authHeader = (fetcher.lastCall?.init?.headers as Record<string, string> | undefined)?.authorization;
    expect(authHeader).toBe('Bearer secret');
  });

  test('partial on mismatch', async () => {
    const fetcher = new MockFetcher(async () =>
      new Response(JSON.stringify({ name: 'Other' }), { status: 200 }),
    );
    const src = new KboVerificationSource({ baseUrl: 'https://api.kbo.be', fetcher });
    const r = await src.verify({ euid: beEuid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('partial');
  });

  test('partial on bad JSON', async () => {
    const fetcher = new MockFetcher(async () => new Response('oops', { status: 200 }));
    const src = new KboVerificationSource({ baseUrl: 'https://api.kbo.be', fetcher });
    const r = await src.verify({ euid: beEuid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('partial');
  });

  test('failure on non-200', async () => {
    const fetcher = new MockFetcher(async () => new Response('', { status: 500 }));
    const src = new KboVerificationSource({ baseUrl: 'https://api.kbo.be', fetcher });
    const r = await src.verify({ euid: beEuid.value, legal_name: 'Acme' });
    expect(r.outcome).toBe('failure');
  });
});
