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
import { composeFhirR5Recipe } from '../src/index.ts';

const bvad: BvadClaims = {
  iss: 'https://asr',
  sub: 'urn:bdi:connector:peer',
  aud: 'urn:bdi:association:care',
  iat: 1000,
  exp: 1600,
  jti: '9f3a2c10-1234-4abc-89ab-cdef01234567',
  [BVAD_CLAIM_ASSOCIATION]: 'care',
  [BVAD_CLAIM_ORGANISATION]: { euid: 'NL.NHR.1', legal_name: 'Acme Clinic' },
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
  [BVOD_CLAIM_ASSOCIATION]: 'care',
  [BVOD_CLAIM_CHAIN_CONTEXT]: { id: 'cctx', kind: 'referral', identifiers: [] },
  [BVOD_CLAIM_INVOLVEMENT]: { member_euid: 'NL.NHR.1', roles: ['provider'] },
  [BVOD_CLAIM_SCOPE]: ['write:referral'],
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
      associationId: 'care',
      audience: 'urn:bdi:association:care',
    },
  );
}

describe('composeFhirR5Recipe wired into ProxyForwardUseCase', () => {
  test('rejects malformed FHIR with invalid-payload', async () => {
    const recipe = composeFhirR5Recipe();
    const uc = new ProxyForwardUseCase(mkVerify(), new RecordingHeaderedHttpClient(), {
      routes: [{ pathPrefix: '/fhir', target: 'http://backend' }],
      inspectors: recipe.inspectors,
    });
    const r = await uc.execute({
      method: 'POST',
      path: '/fhir/ServiceRequest',
      headers: { 'content-type': 'application/fhir+json' },
      body: JSON.stringify({ resourceType: 'ServiceRequest', status: 'active' }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:fhir',
      resource: { type: 'fhir', id: '/fhir/ServiceRequest' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.type === 'invalid-payload') {
      expect(r.error.inspector).toBe('fhir-r5');
      expect(r.error.reason).toBe('fhir-validation-failed');
    } else {
      throw new Error('expected invalid-payload error');
    }
  });

  test('passes a referral through and surfaces tags to the PDP', async () => {
    let captured: PdpInput | undefined;
    const recipe = composeFhirR5Recipe();
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(
      mkVerify((i) => {
        captured = i;
      }),
      http,
      {
        routes: [{ pathPrefix: '/fhir', target: 'http://backend' }],
        inspectors: recipe.inspectors,
      },
    );
    const r = await uc.execute({
      method: 'POST',
      path: '/fhir/ServiceRequest',
      headers: { 'content-type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'ServiceRequest',
        id: 'sr-7',
        status: 'active',
        intent: 'order',
        subject: { reference: 'Patient/p-1' },
      }),
      bvad: 'tok',
      bvod: 'tok',
      action: 'write:fhir',
      resource: { type: 'fhir', id: '/fhir/ServiceRequest' },
    });
    expect(r.ok).toBe(true);
    expect(captured?.resource.tags).toMatchObject({
      'fhir.resourceType': 'ServiceRequest',
      'fhir.id': 'sr-7',
      'fhir.version': '5.0.0',
    });
    expect(http.calls.length).toBe(1);
  });

  test('skips FHIR check for unrelated content types', async () => {
    const recipe = composeFhirR5Recipe();
    const http = new RecordingHeaderedHttpClient();
    const uc = new ProxyForwardUseCase(mkVerify(), http, {
      routes: [{ pathPrefix: '/fhir', target: 'http://backend' }],
      inspectors: recipe.inspectors,
    });
    const r = await uc.execute({
      method: 'GET',
      path: '/fhir/metadata',
      headers: { 'content-type': 'application/json' },
      body: '',
      bvad: 'tok',
      bvod: 'tok',
      action: 'read:metadata',
      resource: { type: 'fhir', id: '/fhir/metadata' },
    });
    expect(r.ok).toBe(true);
  });
});
