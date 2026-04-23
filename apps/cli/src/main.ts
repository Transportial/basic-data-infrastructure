#!/usr/bin/env bun
// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import { RealCliIO, parseArgs } from './commands.ts';
import { ALL_COMMANDS } from './impl.ts';

export interface ContextFactory {
  (): RealCliIO & { fetch: typeof fetch };
}

export async function run(
  argv: ReadonlyArray<string>,
  factory: ContextFactory = () =>
    Object.assign(new RealCliIO(), { fetch: globalThis.fetch.bind(globalThis) }),
): Promise<number> {
  if (argv.length === 0) {
    printHelp();
    return 2;
  }
  const [commandName, ...rest] = argv;
  const command = ALL_COMMANDS.find((c) => c.name === commandName);
  if (!command) {
    if (commandName === '--help' || commandName === '-h' || commandName === 'help') {
      printHelp();
      return 0;
    }
    process.stderr.write(`unknown command: ${commandName}\n`);
    printHelp();
    return 2;
  }
  const args = parseArgs(rest);
  const io = factory();
  return command.execute(args, io);
}

function printHelp(): void {
  process.stdout.write('bdi <command> [options]\n\nCommands:\n');
  for (const c of ALL_COMMANDS) {
    process.stdout.write(`  ${c.name.padEnd(22)} ${c.description}\n`);
  }
  process.stdout.write('\nUse `bdi <command>` with no args to see flags.\n');
}

if (import.meta.main) {
  const code = await run(process.argv.slice(2));
  process.exit(code);
}
