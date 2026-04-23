// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { PdpDecision, PdpInput, PolicyDecisionPoint } from '../pdp.ts';

// Cedar PDP adapter. Runs `cedar authorize --policies <policies.cedar>
// --entities <entities.json> --request-json <stdin>` and reads the decision
// from stdout. The `runner` port isolates the process invocation so tests
// can drive an in-memory "cedar-cli" substitute; the default wiring shells
// out to Bun.spawn.

export interface CedarRunner {
  execute(input: {
    policiesFile: string;
    entitiesFile: string;
    requestJson: string;
  }): Promise<{ stdout: string; exitCode: number }>;
}

export interface CedarAdapterOptions {
  readonly policiesFile: string;
  readonly entitiesFile: string;
  readonly runner?: CedarRunner;
}

export class CedarPdp implements PolicyDecisionPoint {
  constructor(private readonly options: CedarAdapterOptions) {}

  async decide(input: PdpInput): Promise<PdpDecision> {
    const runner = this.options.runner ?? new BunSpawnCedarRunner();
    const request = {
      principal: `Connector::"${input.subject.connector_id}"`,
      action: `Action::"${input.action}"`,
      resource: `${input.resource.type}::"${input.resource.id}"`,
      context: {
        ...input.context,
        subject: input.subject,
        resource_tags: input.resource.tags ?? {},
      },
    };
    let out: { stdout: string; exitCode: number };
    try {
      out = await runner.execute({
        policiesFile: this.options.policiesFile,
        entitiesFile: this.options.entitiesFile,
        requestJson: JSON.stringify(request),
      });
    } catch (e) {
      return { effect: 'deny', reason: `cedar-runner:${e instanceof Error ? e.message : 'unknown'}` };
    }
    if (out.exitCode !== 0) {
      return { effect: 'deny', reason: `cedar-exit-${out.exitCode}` };
    }
    const parsed = parseCedarOutput(out.stdout);
    return parsed ?? { effect: 'deny', reason: 'cedar-unparseable' };
  }
}

export function parseCedarOutput(stdout: string): PdpDecision | null {
  const trimmed = stdout.trim().toLowerCase();
  if (trimmed === 'allow' || trimmed.includes('decision: allow')) return { effect: 'permit' };
  if (trimmed === 'deny' || trimmed.includes('decision: deny')) return { effect: 'deny', reason: 'cedar-deny' };
  try {
    const json = JSON.parse(stdout) as { decision?: string; determining_policies?: string[] };
    if (json.decision?.toLowerCase() === 'allow') return { effect: 'permit' };
    if (json.decision?.toLowerCase() === 'deny') {
      return { effect: 'deny', reason: json.determining_policies?.join(',') ?? 'cedar-deny' };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

// Bun.spawn-backed runner; separated so tests needn't actually run a cedar CLI.
class BunSpawnCedarRunner implements CedarRunner {
  async execute(input: {
    policiesFile: string;
    entitiesFile: string;
    requestJson: string;
  }): Promise<{ stdout: string; exitCode: number }> {
    const proc = (globalThis as { Bun?: { spawn: typeof Bun.spawn } }).Bun?.spawn?.({
      cmd: [
        'cedar',
        'authorize',
        '--policies',
        input.policiesFile,
        '--entities',
        input.entitiesFile,
        '--request-json',
        '-',
      ],
      stdin: new TextEncoder().encode(input.requestJson),
      stdout: 'pipe',
    });
    if (!proc) throw new Error('Bun.spawn not available');
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { stdout, exitCode };
  }
}
