// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { generateKeyPair, publicJwk } from '@bdi/crypto';
import { makeConnectorId, parseAssociationId, parseEuid } from '@bdi/kernel';
import type { Command, CliIO, ParsedArgs } from './commands.ts';

// BDI admin CLI. Commands use a pluggable HTTP `fetch` (so they can drive
// either an in-process composition or a remote ASR/ORS). The fetch callable
// must be set on the IO for the commands to reach the services — in tests we
// inject a recording one; in production we default to `globalThis.fetch` bound
// to the caller's shell env (ASR_URL, CLIENT_ASSERTION, etc.).

export interface HttpCaller {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CliContext extends CliIO {
  fetch: HttpCaller;
}

async function httpJson(
  ctx: CliContext,
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  const res = await ctx.fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export const registerMember: Command = {
  name: 'register-member',
  description: 'Register a new draft member via the ASR admin API.',
  usage: 'bdi register-member --asr <url> --euid NL.NHR.12345678 --association-id ctn --legal-name "Acme BV" [--vat NL...] [--lei HWUPKR...]',
  async execute(args: ParsedArgs, io: CliIO): Promise<number> {
    const ctx = io as CliContext;
    const asr = requireFlag(args, 'asr');
    const rawEuid = requireFlag(args, 'euid');
    const assocRaw = requireFlag(args, 'association-id');
    const legal = requireFlag(args, 'legal-name');
    if (!asr || !rawEuid || !assocRaw || !legal) {
      io.stderr(this.usage);
      return 2;
    }
    const euid = parseEuid(rawEuid);
    const assoc = parseAssociationId(assocRaw);
    if (!euid.ok || !assoc.ok) {
      io.stderr('bad-identifier');
      return 2;
    }
    const body: Record<string, unknown> = {
      euid: euid.value,
      association_id: assoc.value,
      legal_name: legal,
    };
    if (typeof args.flags.vat === 'string') body.vat_number = args.flags.vat;
    if (typeof args.flags.lei === 'string') body.lei = args.flags.lei;
    const res = await httpJson(ctx, 'POST', `${asr}/admin/members`, body);
    io.stdout(JSON.stringify(res.data));
    return res.status === 201 ? 0 : 1;
  },
};

export const approveMember: Command = {
  name: 'approve-member',
  description: 'Record a 4-eyes approval towards activation.',
  usage: 'bdi approve-member --asr <url> --member <id> --approver <name>',
  async execute(args, io) {
    const ctx = io as CliContext;
    const asr = requireFlag(args, 'asr');
    const member = requireFlag(args, 'member');
    const approver = requireFlag(args, 'approver');
    if (!asr || !member || !approver) {
      io.stderr(this.usage);
      return 2;
    }
    const res = await httpJson(ctx, 'POST', `${asr}/admin/members/${member}/approve`, { approver });
    io.stdout(JSON.stringify(res.data));
    return res.status === 200 ? 0 : 1;
  },
};

export const runVerifications: Command = {
  name: 'run-verifications',
  description: 'Kick off authoritative-register verifications for a draft member.',
  usage: 'bdi run-verifications --asr <url> --member <id>',
  async execute(args, io) {
    const ctx = io as CliContext;
    const asr = requireFlag(args, 'asr');
    const member = requireFlag(args, 'member');
    if (!asr || !member) {
      io.stderr(this.usage);
      return 2;
    }
    const res = await httpJson(ctx, 'POST', `${asr}/admin/members/${member}/run-verifications`);
    io.stdout(JSON.stringify(res.data));
    return res.status === 202 ? 0 : 1;
  },
};

export const registerConnector: Command = {
  name: 'register-connector',
  description: 'Register a connector and its public JWK with the ASR.',
  usage:
    'bdi register-connector --asr <url> --member <id> --client-id <id> --jwk <file> --kid <kid> --cert-thumbprint <tp> --cert-not-after <unix> --callback <url>... --authorised-by <rep>',
  async execute(args, io) {
    const ctx = io as CliContext;
    const asr = requireFlag(args, 'asr');
    const member = requireFlag(args, 'member');
    const clientId = requireFlag(args, 'client-id');
    const jwkFile = requireFlag(args, 'jwk');
    const kid = requireFlag(args, 'kid');
    const thumb = requireFlag(args, 'cert-thumbprint');
    const notAfter = Number(requireFlag(args, 'cert-not-after'));
    const callback = requireFlag(args, 'callback');
    const authorisedBy = requireFlag(args, 'authorised-by');
    if (!asr || !member || !clientId || !jwkFile || !kid || !thumb || !authorisedBy || !Number.isFinite(notAfter)) {
      io.stderr(this.usage);
      return 2;
    }
    const jwk = JSON.parse(io.readFileString(jwkFile));
    const res = await httpJson(ctx, 'POST', `${asr}/admin/connectors`, {
      member_id: member,
      client_id: clientId,
      jwk,
      kid,
      cert_thumbprint: thumb,
      cert_not_after: notAfter,
      callback_urls: callback ? [callback] : [],
      authorised_by: authorisedBy,
    });
    io.stdout(JSON.stringify(res.data));
    return res.status === 201 ? 0 : 1;
  },
};

export const generateKey: Command = {
  name: 'generate-key',
  description: 'Generate an ECDSA P-256 key pair and write the public + private JWKs to files.',
  usage: 'bdi generate-key --out-public pub.jwk --out-private priv.jwk [--alg ES256|ES384|EdDSA|PS256]',
  async execute(args, io) {
    const pub = requireFlag(args, 'out-public');
    const priv = requireFlag(args, 'out-private');
    if (!pub || !priv) {
      io.stderr(this.usage);
      return 2;
    }
    const alg = (typeof args.flags.alg === 'string' ? args.flags.alg : 'ES256') as 'ES256' | 'ES384' | 'EdDSA' | 'PS256';
    const kp = await generateKeyPair(alg);
    io.writeFileString(pub, JSON.stringify(publicJwk(kp.publicJwk), null, 2));
    io.writeFileString(priv, JSON.stringify(kp.privateJwk, null, 2));
    io.stdout(JSON.stringify({ kid: kp.kid, alg }));
    return 0;
  },
};

export const createChainContext: Command = {
  name: 'create-chain-context',
  description: 'Create a chain context via the ORS API.',
  usage: 'bdi create-chain-context --ors <url> --association-id ctn --orchestrator NL.NHR.xxx --kind shipment',
  async execute(args, io) {
    const ctx = io as CliContext;
    const ors = requireFlag(args, 'ors');
    const assoc = requireFlag(args, 'association-id');
    const orch = requireFlag(args, 'orchestrator');
    const kind = requireFlag(args, 'kind');
    if (!ors || !assoc || !orch || !kind) {
      io.stderr(this.usage);
      return 2;
    }
    const res = await httpJson(ctx, 'POST', `${ors}/contexts`, {
      association_id: assoc,
      orchestrator: orch,
      kind,
      identifiers: [],
    });
    io.stdout(JSON.stringify(res.data));
    return res.status === 201 ? 0 : 1;
  },
};

export const addConnectorId: Command = {
  name: 'make-connector-id',
  description: 'Print a URN-form connector id for a UUID.',
  usage: 'bdi make-connector-id --uuid <uuid>',
  async execute(args, io) {
    const uuid = requireFlag(args, 'uuid');
    if (!uuid) {
      io.stderr(this.usage);
      return 2;
    }
    const r = makeConnectorId(uuid);
    if (!r.ok) {
      io.stderr(`bad-uuid: ${uuid}`);
      return 2;
    }
    io.stdout(r.value);
    return 0;
  },
};

export const ALL_COMMANDS: ReadonlyArray<Command> = [
  registerMember,
  runVerifications,
  approveMember,
  registerConnector,
  generateKey,
  createChainContext,
  addConnectorId,
];

function requireFlag(args: ParsedArgs, name: string): string | null {
  const v = args.flags[name];
  return typeof v === 'string' ? v : null;
}
