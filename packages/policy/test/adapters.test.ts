// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import type { PdpInput } from '../src/pdp.ts';
import { OpaPdp } from '../src/adapters/opa.ts';
import { CedarPdp, parseCedarOutput } from '../src/adapters/cedar.ts';
import { KeycloakPdp } from '../src/adapters/keycloak.ts';

const input: PdpInput = {
  subject: {
    connector_id: 'urn:bdi:connector:1',
    organisation_euid: 'NL.NHR.1',
    assurance: 'high',
    status: 'active',
  },
  context: { roles: ['carrier'] },
  action: 'read:shipment',
  resource: { type: 'Shipment', id: 's-1' },
};

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('OpaPdp', () => {
  test('true → permit', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa:8181',
      packagePath: 'bdi.authz',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: true }), { status: 200 })) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect).toBe('permit');
  });

  test('false → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: false }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('object shape is honoured', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () =>
        new Response(
          JSON.stringify({ result: { effect: 'permit', obligations: [{ type: 'mask', args: { field: 'pii' } }] } }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect).toBe('permit');
  });

  test('deny shape with reason', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () =>
        new Response(JSON.stringify({ result: { effect: 'deny', reason: 'not-allowed' } }), { status: 200 }),
      ) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toBe('not-allowed');
  });

  test('bearer token adds authorization header', async () => {
    let seenAuth: string | null = null;
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      token: 'secret',
      fetcher: mockFetch(async (_url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        seenAuth = headers?.authorization ?? null;
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await pdp.decide(input);
    expect(seenAuth).toBe('Bearer secret');
  });

  test('non-200 → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('transport error → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => {
        throw new Error('net');
      }) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('opa-transport');
  });

  test('invalid JSON → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('null result → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: null }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('unknown shape → deny', async () => {
    const pdp = new OpaPdp({
      baseUrl: 'http://opa',
      packagePath: 'p',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: 123 }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });
});

describe('CedarPdp', () => {
  test('Allow stdout → permit', async () => {
    const pdp = new CedarPdp({
      policiesFile: '/etc/bdi/policies.cedar',
      entitiesFile: '/etc/bdi/entities.json',
      runner: {
        async execute() {
          return { stdout: 'Allow', exitCode: 0 };
        },
      },
    });
    expect((await pdp.decide(input)).effect).toBe('permit');
  });

  test('Deny stdout → deny', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: { async execute() { return { stdout: 'Deny', exitCode: 0 }; } },
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('JSON stdout with decision', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: {
        async execute() {
          return { stdout: JSON.stringify({ decision: 'Allow' }), exitCode: 0 };
        },
      },
    });
    expect((await pdp.decide(input)).effect).toBe('permit');
  });

  test('JSON stdout with Deny and determining policies', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: {
        async execute() {
          return { stdout: JSON.stringify({ decision: 'Deny', determining_policies: ['p1', 'p2'] }), exitCode: 0 };
        },
      },
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('p1');
  });

  test('non-zero exit → deny', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: { async execute() { return { stdout: '', exitCode: 2 }; } },
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('runner error → deny', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: { async execute() { throw new Error('boom'); } },
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('cedar-runner');
  });

  test('unparseable stdout → deny', async () => {
    const pdp = new CedarPdp({
      policiesFile: 'p',
      entitiesFile: 'e',
      runner: { async execute() { return { stdout: 'weird', exitCode: 0 }; } },
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('unparseable');
  });

  test('parseCedarOutput helpers', () => {
    expect(parseCedarOutput('Decision: Allow')?.effect).toBe('permit');
    expect(parseCedarOutput('Decision: Deny')?.effect).toBe('deny');
    expect(parseCedarOutput('blob')).toBeNull();
    expect(parseCedarOutput(JSON.stringify({ decision: 'unknown' }))).toBeNull();
  });
});

describe('KeycloakPdp', () => {
  test('200 with result=true → permit', async () => {
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc/realms/x/token',
      audience: 'bdi-api',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: true }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('permit');
  });

  test('200 with result=false → deny', async () => {
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc',
      audience: 'a',
      fetcher: mockFetch(async () => new Response(JSON.stringify({ result: false }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await pdp.decide(input)).effect).toBe('deny');
  });

  test('403 → deny forbidden', async () => {
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc',
      audience: 'a',
      fetcher: mockFetch(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('forbidden');
  });

  test('other non-200 → deny status', async () => {
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc',
      audience: 'a',
      fetcher: mockFetch(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('500');
  });

  test('transport error → deny', async () => {
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc',
      audience: 'a',
      fetcher: mockFetch(async () => {
        throw new Error('net');
      }) as unknown as typeof fetch,
    });
    const d = await pdp.decide(input);
    expect(d.effect === 'deny' && d.reason).toContain('transport');
  });

  test('custom subject token function is used', async () => {
    let seenAuth: string | null = null;
    const pdp = new KeycloakPdp({
      tokenEndpoint: 'http://kc',
      audience: 'a',
      subjectTokenFromInput: () => 'my-token',
      fetcher: mockFetch(async (_url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        seenAuth = headers?.authorization ?? null;
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await pdp.decide(input);
    expect(seenAuth).toBe('Bearer my-token');
  });
});
