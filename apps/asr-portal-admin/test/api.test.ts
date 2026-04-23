// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { AsrClient } from '../src/api.ts';

function mkFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('AsrClient', () => {
  test('createMember', async () => {
    const calls: string[] = [];
    const client = new AsrClient(
      'https://asr',
      mkFetch((url) => {
        calls.push(url);
        return new Response(JSON.stringify({ member_id: 'm-1' }), { status: 201 });
      }) as unknown as typeof fetch,
    );
    const out = await client.createMember({
      euid: 'NL.NHR.12345678',
      association_id: 'ctn',
      legal_name: 'Acme',
    });
    expect(out.member_id).toBe('m-1');
    expect(calls[0]).toBe('https://asr/admin/members');
  });

  test('createMember throws on non-2xx', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('bad', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.createMember({ euid: 'x', association_id: 'ctn', legal_name: 'y' }),
    ).rejects.toThrow();
  });

  test('runVerifications posts', async () => {
    const urls: string[] = [];
    const client = new AsrClient(
      'https://asr',
      mkFetch((url) => {
        urls.push(url);
        return new Response(null, { status: 202 });
      }) as unknown as typeof fetch,
    );
    await client.runVerifications('m-1');
    expect(urls[0]).toBe('https://asr/admin/members/m-1/run-verifications');
  });

  test('runVerifications throws on error', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('', { status: 500 })) as unknown as typeof fetch,
    );
    await expect(client.runVerifications('m-1')).rejects.toThrow();
  });

  test('approve returns state', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response(JSON.stringify({ state: 'activated' }), { status: 200 })) as unknown as typeof fetch,
    );
    const out = await client.approve('m-1', 'alice');
    expect(out.state).toBe('activated');
  });

  test('approve throws', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('no', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(client.approve('m-1', 'x')).rejects.toThrow();
  });

  test('suspend + revoke post', async () => {
    const urls: string[] = [];
    const client = new AsrClient(
      'https://asr',
      mkFetch((url) => {
        urls.push(url);
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    );
    await client.suspend('m-1');
    await client.revoke('m-1');
    expect(urls).toEqual([
      'https://asr/admin/members/m-1/suspend',
      'https://asr/admin/members/m-1/revoke',
    ]);
  });

  test('suspend / revoke throw on error', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('', { status: 500 })) as unknown as typeof fetch,
    );
    await expect(client.suspend('m-1')).rejects.toThrow();
    await expect(client.revoke('m-1')).rejects.toThrow();
  });

  test('trustlist returns raw text', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('jws-here', { status: 200 })) as unknown as typeof fetch,
    );
    expect(await client.trustlist('ctn')).toBe('jws-here');
  });

  test('trustlist throws', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('', { status: 404 })) as unknown as typeof fetch,
    );
    await expect(client.trustlist('x')).rejects.toThrow();
  });

  test('jwks returns JSON', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response(JSON.stringify({ keys: [{ kty: 'EC' }] }), { status: 200 })) as unknown as typeof fetch,
    );
    const j = await client.jwks();
    expect(j.keys.length).toBe(1);
  });

  test('jwks throws', async () => {
    const client = new AsrClient(
      'https://asr',
      mkFetch(() => new Response('', { status: 500 })) as unknown as typeof fetch,
    );
    await expect(client.jwks()).rejects.toThrow();
  });
});
