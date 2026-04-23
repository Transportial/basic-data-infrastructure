// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { StaticBearerAuthn, type Principal } from '../src/authn.ts';

describe('StaticBearerAuthn', () => {
  const alice: Principal = { subject: 'alice', roles: ['admin'] };
  const authn = new StaticBearerAuthn(new Map([['tok-alice', alice]]));

  test('returns principal for known token', async () => {
    const r = await authn.authenticate('tok-alice');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.subject).toBe('alice');
  });

  test('missing-token for empty bearer', async () => {
    const r = await authn.authenticate('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('missing-token');
  });

  test('bad-signature for unknown token', async () => {
    const r = await authn.authenticate('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('bad-signature');
  });
});
