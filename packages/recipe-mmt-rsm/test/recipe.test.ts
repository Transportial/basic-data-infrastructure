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
import { composeMmtRsmRecipe } from '../src/index.ts';

const bvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:association:cross-border',
  iat: 1000,
  exp: 1600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'cross-border',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme Forwarding' },
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
  [BVOD_CLAIM_ASSOCIATION]: 'cross-border',
  [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'shipment', identifiers: [] },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['forwarder'] },
  [BVOD_CLAIM_SCOPE]: ['write:customs'],
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
      associationId: 'cross-border',
      audience: 'urn:bdi:association:cross-border',
    },
  );
}

describe('composeMmtRsmRecipe wired into ProxyForwardUseCase', () => {
  test('rejects malformed MMT-RSM with invalid-payload', async () => {
    const recipe = composeMmtRsmRecipe();
    const uc = new ProxyForwardUseCase(mkVerify(), new RecordingHeaderedHttpClient(), {
      routes: [{ pathPrefix: '/api', target: 'http://backend' }],
      inspectors: recipe.inspectors,
    });
    const r = await uc.execute({
      method: 'POST',
      path: '/api/customs',
      headers: { 'content-type': 'application/vnd.uncefact.mmt-rsm+json' },
      body: JSON.stringify({ id: 'x', entityType: 'shipment' }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:customs',
      resource: { type: 'mmt-rsm', id: '/api/customs' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.type === 'invalid-payload') {
      expect(r.error.inspector).toBe('mmt-rsm');
      expect(r.error.reason).toBe('mmt-rsm-validation-failed');
    } else {
      throw new Error('expected invalid-payload error');
    }
  });

  test('passes valid MMT-RSM through and surfaces tags to the PDP', async () => {
    let captured: PdpInput | undefined;
    const recipe = composeMmtRsmRecipe();
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
      path: '/api/customs',
      headers: { 'content-type': 'application/vnd.uncefact.mmt-rsm+json' },
      body: JSON.stringify({
        id: 'cn-7',
        entityType: 'consignment',
        consignor: { id: 'p-s' },
        consignee: { id: 'p-c' },
      }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:customs',
      resource: { type: 'mmt-rsm', id: '/api/customs' },
    });
    expect(r.ok).toBe(true);
    expect(captured?.resource.tags).toMatchObject({
      'mmt-rsm.entityType': 'consignment',
      'mmt-rsm.id': 'cn-7',
      'mmt-rsm.version': '1.0.0',
    });
    expect(http.calls.length).toBe(1);
  });

  test('skips MMT-RSM check for unrelated content types', async () => {
    const recipe = composeMmtRsmRecipe();
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
