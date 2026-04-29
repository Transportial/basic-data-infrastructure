// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createHarness, type BdiHarness } from '../src/index.ts';

let harness: BdiHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.stop();
});

describe('harness — health checks', () => {
  test('all three services answer /health/live', async () => {
    const [asr, ors, con] = await Promise.all([
      harness.asr.get('/health/live'),
      harness.ors.get('/health/live'),
      harness.con.get('/health/live'),
    ]);
    expect(asr.status).toBe(200);
    expect(ors.status).toBe(200);
    expect(con.status).toBe(200);
  });

  test('all three services answer /health/ready', async () => {
    const [asr, ors, con] = await Promise.all([
      harness.asr.get('/health/ready'),
      harness.ors.get('/health/ready'),
      harness.con.get('/health/ready'),
    ]);
    expect(asr.status).toBe(200);
    expect(ors.status).toBe(200);
    expect(con.status).toBe(200);
  });

  test('network routes by issuer URL', async () => {
    // The harness network is keyed off the issuer URLs. If we call ASR via a
    // raw fetch through the network, we should hit ASR's router.
    const res = await harness.network.fetch(`${harness.issuers.asr}/health/live`);
    expect(res.status).toBe(200);
  });

  test('unregistered URLs return 502 from the network', async () => {
    const res = await harness.network.fetch('https://nowhere.example/x');
    expect(res.status).toBe(502);
  });
});
