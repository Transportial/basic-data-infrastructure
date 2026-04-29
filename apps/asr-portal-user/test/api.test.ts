// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { UserAsrClient } from '../src/api.ts';

function mkFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('UserAsrClient', () => {
  test('startOnboarding posts to /admin/members', async () => {
    const calls: string[] = [];
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch((url) => {
        calls.push(url);
        return new Response(JSON.stringify({ member_id: 'm-1' }), { status: 201 });
      }) as unknown as typeof fetch,
    );
    const r = await client.startOnboarding({
      euid: 'NL.NHR.12345678',
      legal_name: 'Acme',
      signing_representative: {
        subject_id: 's',
        auth_source: 'manual',
        assurance: 'high',
        verified_at: '2026-04-23T00:00:00Z',
      },
    });
    expect(r.memberId).toBe('m-1');
    expect(calls[0]).toBe('https://asr/admin/members');
  });

  test('startOnboarding throws on error', async () => {
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch(() => new Response('oops', { status: 400 })) as unknown as typeof fetch,
    );
    await expect(
      client.startOnboarding({
        euid: 'x',
        legal_name: 'x',
        signing_representative: {
          subject_id: 's',
          auth_source: 'manual',
          assurance: 'high',
          verified_at: '',
        },
      }),
    ).rejects.toThrow();
  });

  test('triggerVerifications happy path', async () => {
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch(() => new Response(null, { status: 202 })) as unknown as typeof fetch,
    );
    await client.triggerVerifications('m-1');
  });

  test('triggerVerifications throws on error', async () => {
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch(() => new Response('', { status: 404 })) as unknown as typeof fetch,
    );
    await expect(client.triggerVerifications('m-1')).rejects.toThrow();
  });

  test('fetchMemberDescriptor returns JWS string', async () => {
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch(() => new Response('a.b.c', { status: 200 })) as unknown as typeof fetch,
    );
    expect(await client.fetchMemberDescriptor('NL.NHR.12345678')).toBe('a.b.c');
  });

  test('fetchMemberDescriptor throws', async () => {
    const client = new UserAsrClient(
      'https://asr',
      'ctn',
      mkFetch(() => new Response('', { status: 500 })) as unknown as typeof fetch,
    );
    await expect(client.fetchMemberDescriptor('x')).rejects.toThrow();
  });
});
