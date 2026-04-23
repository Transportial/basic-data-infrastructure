// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

export type ParsedArgs = {
  readonly positional: ReadonlyArray<string>;
  readonly flags: Readonly<Record<string, string | boolean>>;
};

export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positional.push(token);
    }
    i++;
  }
  return { positional, flags };
}

export interface Command {
  readonly name: string;
  readonly description: string;
  readonly usage: string;
  execute(args: ParsedArgs, io: CliIO): Promise<number>;
}

export interface CliIO {
  stdout(line: string): void;
  stderr(line: string): void;
  readFileString(path: string): string;
  writeFileString(path: string, content: string): void;
  env(name: string): string | undefined;
}

export class RealCliIO implements CliIO {
  stdout(line: string): void {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  stderr(line: string): void {
    // eslint-disable-next-line no-console
    console.error(line);
  }
  readFileString(path: string): string {
    return require('node:fs').readFileSync(path, 'utf-8') as string;
  }
  writeFileString(path: string, content: string): void {
    require('node:fs').writeFileSync(path, content);
  }
  env(name: string): string | undefined {
    return process.env[name];
  }
}

export class MemoryCliIO implements CliIO {
  readonly stdoutLines: string[] = [];
  readonly stderrLines: string[] = [];
  readonly files = new Map<string, string>();
  readonly envs = new Map<string, string>();
  stdout(line: string): void {
    this.stdoutLines.push(line);
  }
  stderr(line: string): void {
    this.stderrLines.push(line);
  }
  readFileString(path: string): string {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`missing file: ${path}`);
    return v;
  }
  writeFileString(path: string, content: string): void {
    this.files.set(path, content);
  }
  env(name: string): string | undefined {
    return this.envs.get(name);
  }
}
