// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { FakeClock } from '@transportial/kernel';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVOD_CLAIM_ASSOCIATION,
  BVOD_CLAIM_CHAIN_CONTEXT,
  BVOD_CLAIM_INVOLVEMENT,
  BVOD_CLAIM_SCOPE,
  type BvadClaims,
  type BvodClaims,
} from '@transportial/contracts';
import { EmbeddedPdp, type PdpInput } from '@transportial/policy';
import { VerifyIncomingUseCase } from '@transportial/con/application/use-cases/verify-incoming.ts';
import { ProxyForwardUseCase } from '@transportial/con/application/use-cases/proxy-forward.ts';
import { RecordingHeaderedHttpClient } from '@transportial/con/infrastructure/http-forward.ts';
import { composeEftiRecipe } from '../src/index.ts';

const bvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:association:ctn',
  iat: 1000,
  exp: 1600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'ctn',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme' },
  [BVAD_CLAIM_CONNECTOR]: {
    id: 'urn:bdi:connector:peer',
    x5t_s256: 'peer-thumb',
    bound_on: 0,
    authorised_by: 'rep',
  },
  [BVAD_CLAIM_ASSURANCE]: { level: 'high', sources: ['KvK'] },
  [BVAD_CLAIM_STATUS]: 'active',
};

const bvod: BvodClaims = {
  iss: 'https://ors',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:connector:me',
  iat: 1000,
  exp: 2000,
  jti: 'j-1',
  [BVOD_CLAIM_ASSOCIATION]: 'ctn',
  [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'shipment', identifiers: [] },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['carrier'] },
  [BVOD_CLAIM_SCOPE]: ['read:eta'],
};

function mkVerify(pdpCapture?: (i: PdpInput) => void): VerifyIncomingUseCase {
  const pdp = new EmbeddedPdp([
    {
      id: 'all',
      effect: 'permit',
      actions: '*',
      when: (i) => {
        pdpCapture?.(i);
        return true;
      },
    },
  ]);
  return new VerifyIncomingUseCase(
    { refresh: async () => {}, verifyBvad: async () => bvad },
    { verifyBvod: async () => bvod },
    pdp,
    new FakeClock(new Date(1_200_000)),
    {
      asrIssuer: 'https://asr',
      orsIssuer: 'https://ors',
      ownConnectorId: 'urn:bdi:connector:me',
      associationId: 'ctn',
      audience: 'urn:bdi:association:ctn',
    },
  );
}

describe('composeEftiRecipe wired into ProxyForwardUseCase', () => {
  test('rejects malformed eFTI with invalid-payload', async () => {
    const recipe = composeEftiRecipe();
    const uc = new ProxyForwardUseCase(mkVerify(), new RecordingHeaderedHttpClient(), {
      routes: [{ pathPrefix: '/api', target: 'http://backend' }],
      inspectors: recipe.inspectors,
    });
    const r = await uc.execute({
      method: 'POST',
      path: '/api/efti',
      headers: { 'content-type': 'application/vnd.efti+json' },
      body: JSON.stringify({ id: 'x', eftiType: 'shipment' }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:efti',
      resource: { type: 'efti', id: '/api/efti' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.type === 'invalid-payload') {
      expect(r.error.inspector).toBe('efti');
      expect(r.error.reason).toBe('efti-validation-failed');
    } else {
      throw new Error('expected invalid-payload error');
    }
  });

  test('passes valid eFTI through and surfaces tags to the PDP', async () => {
    let captured: PdpInput | undefined;
    const recipe = composeEftiRecipe();
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(
      mkVerify((i) => {
        captured = i;
      }),
      http,
      {
        routes: [{ pathPrefix: '/api', target: 'http://backend' }],
        inspectors: recipe.inspectors,
      },
    );
    const r = await uc.execute({
      method: 'POST',
      path: '/api/efti',
      headers: { 'content-type': 'application/vnd.efti+json' },
      body: JSON.stringify({
        id: 'cn-7',
        eftiType: 'consignment',
        senderParty: { id: 'p-s' },
        consigneeParty: { id: 'p-c' },
      }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:efti',
      resource: { type: 'efti', id: '/api/efti' },
    });
    expect(r.ok).toBe(true);
    expect(captured?.resource.tags).toMatchObject({
      'efti.entityType': 'consignment',
      'efti.id': 'cn-7',
      'efti.version': '1.0.0',
    });
    expect(http.calls.length).toBe(1);
  });

  test('skips eFTI check for unrelated content types', async () => {
    const recipe = composeEftiRecipe();
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/api', target: 'http://backend' }],
      inspectors: recipe.inspectors,
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/api/health',
      headers: { 'content-type': 'application/json' },
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'read:health',
      resource: { type: 'health', id: '/api/health' },
    });
    expect(r.ok).toBe(true);
  });
});
