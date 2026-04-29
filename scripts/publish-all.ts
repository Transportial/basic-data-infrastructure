// Publish every prepared @transportial/* package in topological order.
// Run after `prepare-publish.ts` has rewritten workspace:* deps to fixed versions.
// Uses `npm publish` (bun's publish does not yet support --provenance).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

interface Pkg {
  dir: string;
  name: string;
  deps: Set<string>;
}

const pkgs: Pkg[] = [];
for (const sub of ['apps', 'packages']) {
  const base = join(root, sub);
  for (const name of readdirSync(base)) {
    const pkgPath = join(base, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue;
    if (!pkg.name?.startsWith('@transportial/')) continue;
    const deps = new Set<string>();
    for (const field of ['dependencies', 'peerDependencies'] as const) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (dep.startsWith('@transportial/')) deps.add(dep);
      }
    }
    pkgs.push({ dir: join(sub, name), name: pkg.name, deps });
  }
}

const publishable = new Set(pkgs.map((p) => p.name));
for (const p of pkgs) for (const d of p.deps) if (!publishable.has(d)) p.deps.delete(d);

const ordered: Pkg[] = [];
const remaining = new Map(pkgs.map((p) => [p.name, p]));
while (remaining.size > 0) {
  const ready = [...remaining.values()].filter((p) => [...p.deps].every((d) => !remaining.has(d)));
  if (ready.length === 0) {
    console.error('cyclic dep detected among:', [...remaining.keys()]);
    process.exit(1);
  }
  ready.sort((a, b) => a.name.localeCompare(b.name));
  for (const p of ready) {
    ordered.push(p);
    remaining.delete(p.name);
  }
}

const dryRun = process.argv.includes('--dry-run');
const provenance = process.argv.includes('--provenance');
console.log(`Publish order (${ordered.length})${dryRun ? ' [DRY RUN]' : ''}:`);
for (const p of ordered) console.log(`  ${p.name}`);

for (const p of ordered) {
  console.log(`\n=== publishing ${p.name} ===`);
  const args = ['publish', '--access', 'public'];
  args.push(provenance ? '--provenance' : '--no-provenance');
  if (dryRun) args.push('--dry-run');
  const r = spawnSync('npm', args, { cwd: join(root, p.dir), stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`failed to publish ${p.name}`);
    process.exit(r.status ?? 1);
  }
}
console.log('\nAll packages published.');
