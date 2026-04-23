// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { generateKeyPair, publicJwk, JwkSigner } from '@bdi/crypto';
import { PostgresFederationRegistry } from '../../src/infrastructure/repositories/federation-postgres.ts';
import { InMemorySqlPort } from '../../src/infrastructure/repositories/postgres.ts';

describe('PostgresFederationRegistry', () => {
  test('upsert + byIssuer returns a RawSigner that verifies real signatures', async () => {
    const sql = new InMemorySqlPort();
    const reg = new PostgresFederationRegistry(sql);
    const pair = await generateKeyPair('ES256');
    const pub = publicJwk(pair.privateJwk);
    pub.kid = pair.kid;
    await reg.upsert({
      peer_issuer: 'https://peer-a.example',
      peer_kid: pair.kid,
      peer_alg: 'ES256',
      peer_jwk: pub,
      association_id: 'assoc-local',
      peer_association_id: 'assoc-remote',
      allow: true,
    });
    const peer = await reg.byIssuer('https://peer-a.example');
    expect(peer).not.toBeNull();
    expect(peer?.peer_issuer).toBe('https://peer-a.example');
    expect(peer?.allow).toBe(true);
    expect(peer?.peer_association_id).toBe('assoc-remote');
    // The reconstructed signer verifies against signatures minted with the peer's
    // private key, proving the JWK round-tripped through the SqlPort correctly.
    const peerPriv = new JwkSigner(pair.privateJwk, 'ES256');
    const data = new TextEncoder().encode('hello');
    const sig = await peerPriv.sign(data);
    expect(await peer?.peer_signer.verify(data, sig)).toBe(true);
  });

  test('unknown issuer returns null', async () => {
    const reg = new PostgresFederationRegistry(new InMemorySqlPort());
    const peer = await reg.byIssuer('https://nobody.example');
    expect(peer).toBeNull();
  });

  test('upsert rewrites an existing row', async () => {
    const sql = new InMemorySqlPort();
    const reg = new PostgresFederationRegistry(sql);
    const a = await generateKeyPair('ES256');
    const pubA = publicJwk(a.privateJwk);
    pubA.kid = a.kid;
    await reg.upsert({
      peer_issuer: 'https://peer.example',
      peer_kid: a.kid,
      peer_alg: 'ES256',
      peer_jwk: pubA,
      association_id: 'assoc-local',
      peer_association_id: 'assoc-remote',
      allow: true,
    });
    // Simulate a peer key rotation.
    const b = await generateKeyPair('ES256');
    const pubB = publicJwk(b.privateJwk);
    pubB.kid = b.kid;
    await reg.upsert({
      peer_issuer: 'https://peer.example',
      peer_kid: b.kid,
      peer_alg: 'ES256',
      peer_jwk: pubB,
      association_id: 'assoc-local',
      peer_association_id: 'assoc-remote',
      allow: true,
    });
    const peer = await reg.byIssuer('https://peer.example');
    expect(peer?.peer_kid).toBe(b.kid);
  });

  test('remove deletes an entry', async () => {
    const sql = new InMemorySqlPort();
    const reg = new PostgresFederationRegistry(sql);
    const a = await generateKeyPair('ES256');
    const pubA = publicJwk(a.privateJwk);
    pubA.kid = a.kid;
    await reg.upsert({
      peer_issuer: 'https://peer.example',
      peer_kid: a.kid,
      peer_alg: 'ES256',
      peer_jwk: pubA,
      association_id: 'assoc-local',
      peer_association_id: 'assoc-remote',
      allow: true,
    });
    await reg.remove('https://peer.example');
    expect(await reg.byIssuer('https://peer.example')).toBeNull();
  });
});
