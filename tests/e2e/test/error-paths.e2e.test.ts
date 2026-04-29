// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  addParty,
  buildClientAssertion,
  createChainContext,
  createHarness,
  mintBvad,
  onboardActiveMember,
  registerConnector,
  type BdiHarness,
} from '../src/index.ts';
import { generateKeyPair, publicJwk } from '@transportial/crypto';

let harness: BdiHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.stop();
});

describe('error paths — ASR status mapping', () => {
  test('approve without verifications → 400 not-verified', async () => {
    const created = await harness.asr.post<{ member_id: string }>('/admin/members', {
      euid: 'NL.NHR.50000001',
      association_id: harness.associationId,
      legal_name: 'Skip Verifications',
      signing_representative: {
        subject_id: 'rep',
        auth_source: 'eHerkenning',
        assurance: 'high',
        verified_at: '2026-04-01T00:00:00Z',
      },
    });
    const r = await harness.asr.post<{ error: string }>(
      `/admin/members/${created.body.member_id}/approve`,
      { approver: 'alice' },
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not-verified');
  });

  test('connector with bad callback URL → 400', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.50000002',
      legalName: 'Bad Callback BV',
    });
    const r = await harness.asr.post('/admin/connectors', {
      member_id: memberId,
      client_id: 'bad-callback-client',
      jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
      kid: 'k',
      cert_thumbprint: 'tp',
      cert_not_after: 9_999_999_999,
      callback_urls: ['http://insecure.example/hook'],
      authorised_by: 'rep',
    });
    expect(r.status).toBe(400);
  });

  test('duplicate client_id on connector → 409', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.50000003',
      legalName: 'Dup Client BV',
    });
    await registerConnector(harness, {
      memberId,
      clientId: 'dup-client',
    });
    const second = await harness.asr.post('/admin/connectors', {
      member_id: memberId,
      client_id: 'dup-client',
      jwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
      kid: 'k2',
      cert_thumbprint: 'tp2',
      cert_not_after: 9_999_999_999,
      callback_urls: ['https://x.example/hook'],
      authorised_by: 'rep',
    });
    expect(second.status).toBe(409);
  });

  test('approve when member already activated → 409 already-active', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.50000004',
      legalName: 'Already Active BV',
    });
    const r = await harness.asr.post(`/admin/members/${memberId}/approve`, {
      approver: 'carol',
    });
    expect(r.status).toBe(409);
  });
});

describe('error paths — ASR /oauth2/token', () => {
  test('token-exchange happy path returns issued_token_type', async () => {
    // Register the harness ASR as a federated peer so the exchange can verify
    // the subject_token's signature and re-issue a local BVAD. The default
    // federation registry is the in-memory one and exposes `add()`; cast
    // through the interface since the public type only exposes `byIssuer()`.
    (
      harness.composition.asr.deps.federation as unknown as {
        add(record: {
          peer_issuer: string;
          peer_kid: string;
          peer_signer: import('@transportial/crypto').HmacSigner;
          association_id: string;
          peer_association_id: string;
          allow: boolean;
        }): void;
      }
    ).add({
      peer_issuer: harness.issuers.asr,
      peer_kid: harness.signers.asr.kid,
      peer_signer: harness.signers.asr.signer,
      association_id: harness.associationId,
      peer_association_id: harness.associationId,
      allow: true,
    });

    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.50000005';
    const subjectToken = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const r = await harness.asr.form<{
      access_token: string;
      issued_token_type: string;
    }>('/oauth2/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      audience: 'urn:bdi:asr:peer',
    });
    expect(r.status).toBe(200);
    expect(r.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(r.body.access_token.split('.')).toHaveLength(3);
  });

  test('token-exchange with unfederated peer → 400 peer-not-federated', async () => {
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.50000099';
    const subjectToken = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
      issuerOverride: 'https://stranger.example',
    });
    const r = await harness.asr.form('/oauth2/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      audience: 'urn:bdi:asr:peer',
    });
    expect(r.status).toBe(400);
  });

  test('client_credentials missing form fields → 400 invalid_request', async () => {
    const r = await harness.asr.form('/oauth2/token', {
      grant_type: 'client_credentials',
    });
    expect(r.status).toBe(400);
  });

  test('client_credentials with bad assertion audience → 401', async () => {
    const { memberId } = await onboardActiveMember(harness, {
      euid: 'NL.NHR.50000006',
      legalName: 'Bad Aud BV',
    });
    const keypair = await generateKeyPair('ES256');
    const clientId = 'bad-aud-client';
    await registerConnector(harness, {
      memberId,
      clientId,
      jwk: publicJwk(keypair.publicJwk) as unknown as Readonly<Record<string, unknown>>,
      kid: keypair.kid,
    });
    const assertion = await buildClientAssertion({
      clientId,
      audience: 'https://wrong-audience.example',
      privateJwk: keypair.privateJwk,
    });
    const r = await harness.asr.form('/oauth2/token', {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    });
    expect(r.status).toBe(401);
  });
});

describe('error paths — ORS', () => {
  test('add party to missing context → 404', async () => {
    const r = await harness.ors.post(
      '/contexts/00000000-0000-4000-8000-00000000abcd/parties',
      {
        actor: 'NL.NHR.60000001',
        member_euid: 'NL.NHR.60000002',
        roles: ['carrier'],
      },
    );
    expect(r.status).toBe(404);
  });

  test('add the same party twice → 409', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.60000010' });
    await addParty(harness, {
      chainContextId: ctx.chainContextId,
      actor: 'NL.NHR.60000010',
      memberEuid: 'NL.NHR.60000011',
      roles: ['carrier'],
    });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/parties`, {
      actor: 'NL.NHR.60000010',
      member_euid: 'NL.NHR.60000011',
      roles: ['carrier'],
    });
    expect(r.status).toBe(409);
  });

  test('non-orchestrator adding parties → 403 not-authorised', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.60000020' });
    const r = await harness.ors.post(`/contexts/${ctx.chainContextId}/parties`, {
      actor: 'NL.NHR.60000099',
      member_euid: 'NL.NHR.60000021',
      roles: ['carrier'],
    });
    expect(r.status).toBe(403);
  });

  test('issue BVOD on missing context → 404', async () => {
    const r = await harness.ors.post(
      '/contexts/00000000-0000-4000-8000-00000000beef/bvod',
      {
        subject_euid: 'NL.NHR.60000030',
        subject_connector_id: `urn:bdi:connector:${crypto.randomUUID()}`,
      },
    );
    expect(r.status).toBe(404);
  });

  test('natural-persons on missing context → 404', async () => {
    const r = await harness.ors.post(
      '/contexts/00000000-0000-4000-8000-00000000feed/natural-persons',
      {
        actor: 'NL.NHR.60000040',
        person_ref: 'p',
        role: 'driver',
      },
    );
    expect(r.status).toBe(404);
  });

  test('natural-persons by non-party → 403', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.60000050' });
    const r = await harness.ors.post(
      `/contexts/${ctx.chainContextId}/natural-persons`,
      {
        actor: 'NL.NHR.60000099',
        person_ref: 'p',
        role: 'driver',
      },
    );
    expect(r.status).toBe(403);
  });

  test('duplicate natural-persons pseudonym → 409', async () => {
    const ctx = await createChainContext(harness, { orchestrator: 'NL.NHR.60000060' });
    const post = (): Promise<{ status: number }> =>
      harness.ors.post(`/contexts/${ctx.chainContextId}/natural-persons`, {
        actor: 'NL.NHR.60000060',
        organisation_euid: 'NL.NHR.60000060',
        person_ref: 'employee-dup',
        role: 'driver',
      });
    const first = await post();
    expect(first.status).toBe(201);
    const second = await post();
    expect(second.status).toBe(409);
  });
});

describe('error paths — CON rate limiting', () => {
  test('exceeding rate limit on /proxy-upstream/* → 429', async () => {
    await harness.stop();
    harness = await createHarness({
      con: { rateLimit: { limit: 1, windowMs: 60_000 } },
    });
    const headers = { 'x-client-id': 'rate-limited-upstream-client' };
    // First request is rejected at verification (no BVAD), but counts toward
    // the rate limit. Second hits the 429 branch.
    await harness.con.fetch(
      new Request(harness.con.url('/proxy-upstream/x'), { method: 'GET', headers }),
    );
    const second = await harness.con.fetch(
      new Request(harness.con.url('/proxy-upstream/x'), { method: 'GET', headers }),
    );
    expect(second.status).toBe(429);
  });

  test('exceeding rate limit on /proxy/check → 429', async () => {
    await harness.stop();
    harness = await createHarness({
      con: { rateLimit: { limit: 1, windowMs: 60_000 } },
    });
    const peerConnector = `urn:bdi:connector:${crypto.randomUUID()}`;
    const memberEuid = 'NL.NHR.70000001';
    const bvad = await mintBvad(harness, {
      subjectConnectorId: peerConnector,
      memberEuid,
    });
    const headers = { 'x-client-id': 'rate-limited-client' };
    const body = {
      bvad,
      bvod: 'placeholder',
      action: 'read',
      resource: { type: 't', id: '1' },
    };
    // First request: passes the limiter, fails downstream because BVOD
    // verification will reject the placeholder. Either way rate limiter
    // counter increments.
    await harness.con.post('/proxy/check', body, headers);
    // Second: rate limited.
    const second = await harness.con.post('/proxy/check', body, headers);
    expect(second.status).toBe(429);
  });
});
