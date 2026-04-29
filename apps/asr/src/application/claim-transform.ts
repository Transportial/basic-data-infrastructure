// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { parseYaml, type YamlValue } from '@transportial/config';

// Per-peer claim transformation rules. Used by TokenExchangeUseCase to
// convert a peer's incoming BVAD claims into the locally-re-issued shape,
// so that different federation partners can use slightly different claim
// names or value encodings without the service caring.

export interface ClaimRule {
  readonly rename?: Readonly<Record<string, string>>;
  readonly drop?: ReadonlyArray<string>;
  readonly add?: Readonly<Record<string, unknown>>;
  readonly map?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly defaults?: Readonly<Record<string, unknown>>;
}

export interface ClaimTransformRules {
  readonly peers: ReadonlyArray<{ readonly issuer: string } & ClaimRule>;
  readonly default?: ClaimRule;
}

export type Claims = Record<string, unknown>;

// Apply a rule to a claim set. Order of operations is: defaults → drop →
// rename → map → add. The last step wins so `add` can override earlier
// transforms.
export function applyClaimRule(claims: Claims, rule: ClaimRule): Claims {
  const out: Claims = { ...claims };
  if (rule.defaults) {
    for (const [k, v] of Object.entries(rule.defaults)) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  if (rule.drop) {
    for (const k of rule.drop) delete out[k];
  }
  if (rule.rename) {
    for (const [from, to] of Object.entries(rule.rename)) {
      if (from in out && from !== to) {
        out[to] = out[from];
        delete out[from];
      }
    }
  }
  if (rule.map) {
    for (const [claim, mapping] of Object.entries(rule.map)) {
      const cur = out[claim];
      if (typeof cur === 'string' && cur in mapping) {
        out[claim] = mapping[cur];
      }
    }
  }
  if (rule.add) {
    for (const [k, v] of Object.entries(rule.add)) out[k] = v;
  }
  return out;
}

export function transformForPeer(
  rules: ClaimTransformRules,
  peerIssuer: string,
  claims: Claims,
): Claims {
  const perPeer = rules.peers.find((p) => p.issuer === peerIssuer);
  const merged: ClaimRule = {
    ...rules.default,
    ...perPeer,
    rename: { ...(rules.default?.rename ?? {}), ...(perPeer?.rename ?? {}) },
    add: { ...(rules.default?.add ?? {}), ...(perPeer?.add ?? {}) },
    map: { ...(rules.default?.map ?? {}), ...(perPeer?.map ?? {}) },
    defaults: { ...(rules.default?.defaults ?? {}), ...(perPeer?.defaults ?? {}) },
    drop: [...(rules.default?.drop ?? []), ...(perPeer?.drop ?? [])],
  };
  return applyClaimRule(claims, merged);
}

// Parse YAML configuration into typed claim-transform rules. Throws on
// structural errors so operators catch mis-configuration at boot.
export function parseClaimRules(yamlSource: string): ClaimTransformRules {
  const parsed = parseYaml(yamlSource);
  if (!isRecord(parsed)) throw new Error('claim-rules: top-level must be a mapping');

  const peersRaw = parsed['peers'];
  if (peersRaw !== undefined && !Array.isArray(peersRaw)) {
    throw new Error('claim-rules: peers must be a sequence');
  }
  const peers: Array<{ issuer: string } & ClaimRule> = [];
  for (const entry of (peersRaw as ReadonlyArray<YamlValue> | undefined) ?? []) {
    if (!isRecord(entry)) throw new Error('claim-rules: each peer must be a mapping');
    const issuer = entry['issuer'];
    if (typeof issuer !== 'string' || !issuer) {
      throw new Error('claim-rules: peer.issuer is required');
    }
    peers.push({ issuer, ...coerceRule(entry) });
  }
  const defaultRule = parsed['default'];
  return {
    peers,
    ...(isRecord(defaultRule) ? { default: coerceRule(defaultRule) } : {}),
  };
}

function coerceRule(map: Record<string, YamlValue>): ClaimRule {
  const rule: {
    rename?: Record<string, string>;
    drop?: string[];
    add?: Record<string, unknown>;
    map?: Record<string, Record<string, string>>;
    defaults?: Record<string, unknown>;
  } = {};
  if (map['rename'] !== undefined) {
    if (!isRecord(map['rename'])) throw new Error('rename must be a mapping');
    rule.rename = {};
    for (const [k, v] of Object.entries(map['rename'])) {
      if (typeof v !== 'string') throw new Error('rename values must be strings');
      rule.rename[k] = v;
    }
  }
  if (map['drop'] !== undefined) {
    if (!Array.isArray(map['drop'])) throw new Error('drop must be a sequence');
    rule.drop = (map['drop'] as YamlValue[]).map((v) => {
      if (typeof v !== 'string') throw new Error('drop entries must be strings');
      return v;
    });
  }
  if (map['add'] !== undefined) {
    if (!isRecord(map['add'])) throw new Error('add must be a mapping');
    rule.add = { ...map['add'] };
  }
  if (map['map'] !== undefined) {
    if (!isRecord(map['map'])) throw new Error('map must be a mapping of mappings');
    rule.map = {};
    for (const [claim, mapping] of Object.entries(map['map'])) {
      if (!isRecord(mapping)) throw new Error(`map.${claim} must be a mapping`);
      const sub: Record<string, string> = {};
      for (const [k, v] of Object.entries(mapping)) {
        if (typeof v !== 'string') throw new Error(`map.${claim}.${k} must be a string`);
        sub[k] = v;
      }
      rule.map[claim] = sub;
    }
  }
  if (map['defaults'] !== undefined) {
    if (!isRecord(map['defaults'])) throw new Error('defaults must be a mapping');
    rule.defaults = { ...map['defaults'] };
  }
  return rule;
}

function isRecord(v: unknown): v is Record<string, YamlValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
