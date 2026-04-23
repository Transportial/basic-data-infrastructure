// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import { generateKeyPair, publicJwk, JwkSigner } from '@bdi/crypto';
import { AcmeClient, type ChallengeSolver } from '@bdi/crypto-ca';
import {
  bitString,
  concat,
  integer,
  oid,
  octetString,
  sequence,
  set,
  tlv,
  utf8,
} from '@bdi/crypto-ca';
import { OID, jwkToSpki } from '@bdi/crypto-ca';
import { createServer } from '../../src/server.ts';

async function buildCsr(
  privateJwk: Parameters<typeof JwkSigner>[0],
  publicKeyJwk: Parameters<typeof JwkSigner>[0],
  sans: string[],
): Promise<Uint8Array> {
  const subject = sequence(set(sequence(oid(OID.commonName), utf8(sans[0] ?? 'x'))));
  const spki = jwkToSpki(publicKeyJwk);
  const sanExt = sequence(
    oid(OID.extSubjectAltName),
    octetString(sequence(...sans.map((s) => tlv(0x82, new TextEncoder().encode(s))))),
  );
  const extReq = sequence(oid(OID.extensionRequest), set(sequence(sanExt)));
  const attributes = tlv(0xa0, concat(extReq));
  const tbs = sequence(integer(0), subject, spki, attributes);
  const sigAlg = sequence(oid(OID.ecdsaWithSha256));
  const signer = new JwkSigner(privateJwk, 'ES256');
  const sig = await signer.sign(tbs);
  return sequence(tbs, sigAlg, bitString(sig));
}

describe('ASR ACME endpoints', () => {
  test('GET /acme/directory responds', async () => {
    const s = await createServer({ port: 0, issuer: 'https://asr.test' });
    const res = await s.fetch(new Request('https://asr.test/acme/directory'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newAccount).toBe('https://asr.test/acme/new-account');
  });

  test('full ACME flow through the mounted handler', async () => {
    const s = await createServer({
      port: 0,
      issuer: 'https://asr.test',
      acme: { useStaticVerifiers: true },
    });

    const hmacKey = new Uint8Array(32);
    crypto.getRandomValues(hmacKey);
    s.composition.acme.eab.register({ kid: 'eab-1', hmacKey, clientId: 'c' });

    const client = new AcmeClient({
      directoryUrl: 'https://asr.test/acme/directory',
      transport: {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const req = input instanceof Request ? input : new Request(input, init);
          return s.fetch(req);
        },
      },
    });

    const accountUrl = await client.newAccount({
      eab: { kid: 'eab-1', hmacKey },
      termsOfServiceAgreed: true,
    });
    expect(accountUrl).toContain('/acme/accounts/');

    const order = await client.newOrder([{ type: 'dns', value: 'c.example.com' }]);
    for (const authzUrl of order.authorizations) {
      const authz = await client.getAuthorization(authzUrl);
      const solver: ChallengeSolver = {
        canSolve: (t) => t === 'http-01',
        async present(identifier, token, keyAuthorization) {
          s.composition.acme.staticHttp?.set(identifier, token, keyAuthorization);
        },
      };
      await client.solveAndRespond(authz, [solver]);
    }

    const certKp = await generateKeyPair('ES256');
    const csr = await buildCsr(certKp.privateJwk, publicJwk(certKp.publicJwk), ['c.example.com']);
    const finalOrder = await client.finalize(order, csr);
    expect(finalOrder.status).toBe('valid');
    const pem = await client.fetchCertificate(finalOrder.certificate!);
    expect(pem).toContain('BEGIN CERTIFICATE');
  });
});
