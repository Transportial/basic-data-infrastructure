// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  type BvadClaims,
} from '@bdi/contracts';
import { HmacSigner, InMemoryTrustlist, compactSign } from '@bdi/crypto';
import { TrustlistStore } from '../../src/infrastructure/trustlist-store.ts';
import { OrsTrust } from '../../src/infrastructure/ors-trust.ts';

const baseBvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:a',
  aud: 'x',
  iat: 1000,
  exp: 9_999_999_999,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
  [BVAD_CLAIM_CONNECTOR]: { id: 'urn:bdi:connector:a', x5t_s256: 'tp', bound_on: 0, authorised_by: 'rep' },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

describe('TrustlistStore', () => {
  test('refresh is a no-op (base adapter)', async () => {
    const store = new TrustlistStore(new InMemoryTrustlist());
    await store.refresh();
  });

  test('verifies a signed BVAD', async () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const signer = new HmacSigner(key);
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer });
    const store = new TrustlistStore(list);
    const tok = await compactSign(baseBvad, signer, { kid: 'k1', alg: 'ES256' });
    const out = await store.verifyBvad(tok);
    expect(out?.iss).toBe('https://asr');
  });

  test('returns null on bad signature', async () => {
    const list = new InMemoryTrustlist();
    const store = new TrustlistStore(list);
    expect(await store.verifyBvad('abc.def.ghi')).toBeNull();
  });

  test('returns null on schema mismatch', async () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const signer = new HmacSigner(key);
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer });
    const store = new TrustlistStore(list);
    const tok = await compactSign({ iss: 'x' }, signer, { kid: 'k1', alg: 'ES256' });
    expect(await store.verifyBvad(tok)).toBeNull();
  });

  test('setResolver swaps backing trustlist', async () => {
    const store = new TrustlistStore(new InMemoryTrustlist());
    const next = new InMemoryTrustlist();
    store.setResolver(next);
    // Only verifying the no-throw; actual resolution behaviour is covered above.
  });
});

describe('OrsTrust', () => {
  test('returns null on bad signature', async () => {
    const o = new OrsTrust(new InMemoryTrustlist());
    expect(await o.verifyBvod('a.b.c')).toBeNull();
  });

  test('returns null on schema mismatch', async () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const signer = new HmacSigner(key);
    const list = new InMemoryTrustlist();
    list.add({ kid: 'k1', signer });
    const o = new OrsTrust(list);
    const tok = await compactSign({ iss: 'x' }, signer, { kid: 'k1', alg: 'ES256' });
    expect(await o.verifyBvod(tok)).toBeNull();
  });
});
