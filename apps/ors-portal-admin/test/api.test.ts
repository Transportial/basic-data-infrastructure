// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { OrsClient } from '../src/api.ts';

function mkFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('OrsClient', () => {
  test('createContext', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response(JSON.stringify({ chain_context_id: 'c-1' }), { status: 201 })) as unknown as typeof fetch,
    );
    const r = await client.createContext({
      association_id: 'ctn',
      orchestrator: 'NL.NHR.1',
      kind: 'shipment',
    });
    expect(r.chain_context_id).toBe('c-1');
  });

  test('createContext throws on error', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('no', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.createContext({ association_id: 'x', orchestrator: 'x', kind: 'shipment' }),
    ).rejects.toThrow();
  });

  test('getContext', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() =>
        new Response(
          JSON.stringify({
            id: 'c',
            kind: 'shipment',
            status: 'planned',
            orchestrator_member_id: 'NL.NHR.1',
            parties: [],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );
    const r = await client.getContext('c');
    expect(r.kind).toBe('shipment');
  });

  test('getContext throws', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('', { status: 404 })) as unknown as typeof fetch,
    );
    await expect(client.getContext('x')).rejects.toThrow();
  });

  test('addParty + removeParty', async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const client = new OrsClient(
      'https://ors',
      mkFetch((url, init) => {
        urls.push(url);
        methods.push(init?.method ?? 'GET');
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    );
    await client.addParty('c', { actor: 'a', member_euid: 'm', roles: ['carrier'] });
    await client.removeParty('c', 'a', 'm');
    expect(methods).toEqual(['POST', 'DELETE']);
  });

  test('addParty throws', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.addParty('c', { actor: 'a', member_euid: 'm', roles: [] }),
    ).rejects.toThrow();
  });

  test('removeParty throws', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(client.removeParty('c', 'a', 'm')).rejects.toThrow();
  });

  test('delegate', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response(null, { status: 201 })) as unknown as typeof fetch,
    );
    await client.delegate('c', {
      actor: 'a',
      delegator: 'a',
      delegate: 'b',
      action_scope: ['read'],
    });
  });

  test('delegate throws', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.delegate('c', { actor: 'a', delegator: 'a', delegate: 'b', action_scope: [] }),
    ).rejects.toThrow();
  });

  test('publishEvent returns deliveries', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() =>
        new Response(JSON.stringify({ deliveries: [{ subscription_id: 's', callback_url: 'u' }] }), {
          status: 200,
        }),
      ) as unknown as typeof fetch,
    );
    const r = await client.publishEvent('c', { publisher: 'a', event_type: 't', payload: {} });
    expect(r.deliveries).toHaveLength(1);
  });

  test('publishEvent throws', async () => {
    const client = new OrsClient(
      'https://ors',
      mkFetch(() => new Response('', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.publishEvent('c', { publisher: 'a', event_type: 't', payload: {} }),
    ).rejects.toThrow();
  });
});
