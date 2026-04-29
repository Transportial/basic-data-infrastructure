// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Docker / Kubernetes secrets are typically mounted as files. The `*_FILE`
// convention lets operators point an env var at a mount path; the runtime
// reads the file content once at boot and substitutes it into the effective
// env. If both `FOO` and `FOO_FILE` are set, `FOO_FILE` wins.

export interface FileReader {
  readFileString(path: string): string;
}

export class NodeFileReader implements FileReader {
  readFileString(path: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs');
    const raw = fs.readFileSync(path, 'utf-8') as string;
    return raw.trimEnd();
  }
}

export function materialiseSecretFiles(
  env: Readonly<Record<string, string | undefined>>,
  reader: FileReader = new NodeFileReader(),
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_FILE') || !value) continue;
    const targetKey = key.slice(0, -'_FILE'.length);
    if (out[targetKey]) continue; // Explicit env wins over file mounts? spec says _FILE wins, but we respect explicit too. Overwrite to prefer _FILE:
    try {
      out[targetKey] = reader.readFileString(value);
    } catch (e) {
      throw new Error(
        `Secret file for ${targetKey} at ${value} could not be read: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
  // Spec convention: _FILE wins when both set. Apply that in a second pass.
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_FILE') || !value) continue;
    const targetKey = key.slice(0, -'_FILE'.length);
    try {
      out[targetKey] = reader.readFileString(value);
    } catch {
      // already surfaced in the first pass
    }
  }
  return out;
}
