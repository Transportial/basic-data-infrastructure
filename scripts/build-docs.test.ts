// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..');
const SITE = join(ROOT, 'docs', 'site');

describe('docs site build', () => {
  test('produces the expected pages and wires navigation', () => {
    // Clean up anything from a previous run so we prove the build generates
    // the files we rely on from scratch.
    for (const f of ['index.html', 'architecture.html']) {
      const p = join(SITE, f);
      if (existsSync(p)) rmSync(p);
    }
    for (const dir of ['docs', 'api']) {
      const p = join(SITE, dir);
      if (existsSync(p)) rmSync(p, { recursive: true });
    }

    const openapi = spawnSync('bun', ['run', 'scripts/generate-openapi.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(openapi.status).toBe(0);

    const build = spawnSync('bun', ['run', 'scripts/build-docs.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(build.status).toBe(0);

    // Landing + architecture pages rendered from templates
    expect(existsSync(join(SITE, 'index.html'))).toBe(true);
    expect(existsSync(join(SITE, 'architecture.html'))).toBe(true);

    // Interactive stays untouched (authored directly)
    expect(existsSync(join(SITE, 'interactive', 'index.html'))).toBe(true);
    expect(existsSync(join(SITE, 'interactive', 'interactive.js'))).toBe(true);

    // Docs index + each guide
    expect(existsSync(join(SITE, 'docs', 'index.html'))).toBe(true);
    for (const page of ['SETUP.html', 'ARCHITECTURE.html', 'CONTRIBUTING.html', 'SECURITY.html']) {
      expect(existsSync(join(SITE, 'docs', page))).toBe(true);
    }

    // ADRs
    expect(existsSync(join(SITE, 'docs', 'adr', '0001-bun-runtime.html'))).toBe(true);

    // API pages per service + raw specs
    for (const svc of ['asr', 'ors', 'con']) {
      expect(existsSync(join(SITE, 'api', `${svc}.html`))).toBe(true);
      expect(existsSync(join(SITE, 'api', `${svc}.json`))).toBe(true);
      expect(existsSync(join(SITE, 'api', `${svc}.yaml`))).toBe(true);
    }

    // Spot-check the rendered markdown: the Setup page should mention `bun install`.
    const setup = readFileSync(join(SITE, 'docs', 'SETUP.html'), 'utf8');
    expect(setup).toContain('bun install');
    expect(setup).toContain('<h1');

    // ADR sidebar path is relative to the ADR page (no .. in ADR listings).
    const adr = readFileSync(join(SITE, 'docs', 'adr', '0001-bun-runtime.html'), 'utf8');
    expect(adr).toContain('href="../SETUP.html"');
    expect(adr).toContain('href="0001-bun-runtime.html"');

    // API page embeds Scalar referencing the local JSON spec.
    const apiHtml = readFileSync(join(SITE, 'api', 'asr.html'), 'utf8');
    expect(apiHtml).toContain('@scalar/api-reference');
    expect(apiHtml).toContain('data-url="./asr.json"');

    // Crawler artefacts are emitted alongside the rendered pages.
    expect(existsSync(join(SITE, 'sitemap.xml'))).toBe(true);
    expect(existsSync(join(SITE, 'robots.txt'))).toBe(true);
    const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<urlset');
    // Homepage, one guide, one ADR, one API page — proves every page family
    // makes it in.
    expect(sitemap).toMatch(/<loc>https?:\/\/[^<]+\/<\/loc>/);
    expect(sitemap).toContain('docs/SETUP.html');
    expect(sitemap).toContain('docs/adr/0001-bun-runtime.html');
    expect(sitemap).toContain('api/asr.html');
    const robots = readFileSync(join(SITE, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap:');
    expect(robots).toContain('sitemap.xml');
  });
});
