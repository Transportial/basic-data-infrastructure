// Pre-publish step: rewrite each publishable package's package.json so
// `workspace:*` deps become real semver pointing at the same version.
// Reads version from the git tag passed in argv[2] (e.g. `v0.1.0` -> `0.1.0`)
// and writes it into every publishable package.json.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tag = process.argv[2];
if (!tag) {
  console.error('usage: bun run scripts/prepare-publish.ts <tag>');
  process.exit(1);
}
const version = tag.startsWith('v') ? tag.slice(1) : tag;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`invalid version derived from tag "${tag}": ${version}`);
  process.exit(1);
}

const dirs: string[] = [];
for (const sub of ['apps', 'packages']) {
  const base = join(root, sub);
  for (const name of readdirSync(base)) {
    const pkgPath = join(base, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue;
    if (!pkg.name?.startsWith('@transportial/')) continue;
    dirs.push(join(sub, name));
  }
}

const publishable = new Set(
  dirs.map((d) => JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8')).name as string),
);

for (const d of dirs) {
  const pkgPath = join(root, d, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    if (!pkg[field]) continue;
    for (const [name, range] of Object.entries(pkg[field] as Record<string, string>)) {
      if (range !== 'workspace:*') continue;
      if (publishable.has(name)) {
        pkg[field][name] = `^${version}`;
      } else {
        delete pkg[field][name];
      }
    }
  }

  // Materialise publishConfig file-pointing overrides into the top-level
  // fields. npm only honours `registry`, `tag`, `access`, and `provenance`
  // inside publishConfig (warns + drops the rest). Local dev still uses the
  // pre-rewrite package.json (main → ./src/...), so this script is only run
  // immediately before publish.
  const pc = pkg.publishConfig ?? {};
  for (const key of ['main', 'module', 'types', 'exports', 'bin'] as const) {
    if (pc[key] !== undefined) {
      pkg[key] = pc[key];
      delete pc[key];
    }
  }
  pkg.publishConfig = pc;

  // npm pkg-fix strips a leading "./" from bin entries; do it here too so
  // the warning ("script name ... was invalid and removed") doesn't fire.
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const k of Object.keys(pkg.bin)) {
      const v = pkg.bin[k];
      if (typeof v === 'string' && v.startsWith('./')) pkg.bin[k] = v.slice(2);
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`prepared ${d} -> ${version}`);
}

console.log(`\nPublishable packages (${dirs.length}):`);
for (const d of dirs) console.log(`  ${d}`);
