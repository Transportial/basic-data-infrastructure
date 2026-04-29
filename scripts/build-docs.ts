// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Static-site generator for the BDI documentation at docs/site/.
// Reads:
//   docs/*.md                 → docs/site/docs/*.html
//   docs/adr/*.md             → docs/site/docs/adr/*.html
//   docs/api/{asr,ors,con}.*  → docs/site/api/*.{json,yaml} + Scalar-rendered HTML
//   docs/site/*.html.tpl      → docs/site/*.html (verbatim copy, stripping the .tpl)
//   docs/site/assets          → copied through
//   docs/site/interactive     → copied through
// Outputs everything into docs/site/ ready for GitHub Pages.

import { readdir, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { marked } from 'marked';

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const SITE_DIR = join(DOCS_DIR, 'site');
const ADR_DIR = join(DOCS_DIR, 'adr');
const API_DIR = join(DOCS_DIR, 'api');
const OUT_DOCS = join(SITE_DIR, 'docs');
const OUT_API = join(SITE_DIR, 'api');

// Public origin where GitHub Pages serves the built site. Override with
// BDI_SITE_BASE_URL when deploying to a custom domain. Trailing slash is
// significant — relative URLs in sitemap.xml are resolved against it.
const BASE_URL = (process.env.BDI_SITE_BASE_URL ?? 'https://transportial.github.io/basic-data-infrastructure/').replace(/\/?$/, '/');

const NAV = [
  { href: './', label: 'Overview' },
  { href: 'architecture.html', label: 'Architecture' },
  { href: 'interactive/', label: 'Interactive' },
  { href: 'api/asr.html', label: 'API' },
  { href: 'docs/', label: 'Docs' },
  {
    href: 'https://github.com/Transportial/basic-data-infrastructure',
    label: 'GitHub',
  },
];

const DOC_PAGES = [
  { file: 'SETUP.md', title: 'Setup' },
  { file: 'ARCHITECTURE.md', title: 'Architecture' },
  { file: 'CONTRIBUTING.md', title: 'Contributing' },
  { file: 'SECURITY.md', title: 'Security' },
];

marked.use({
  gfm: true,
  breaks: false,
});

// Minimal CommonMark-ish post-processing so headings get slug ids for deep
// links; marked already outputs GFM tables and fenced code.
const headingIds = new Map<string, number>();
const renderer = new marked.Renderer();
renderer.heading = ({ tokens, depth }) => {
  const text = tokens.map((t) => ('text' in t ? t.text : '')).join('');
  const baseSlug = slug(text);
  const count = headingIds.get(baseSlug) ?? 0;
  headingIds.set(baseSlug, count + 1);
  const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;
  return `<h${depth} id="${id}"><a class="h-anchor" href="#${id}">#</a> ${marked.parseInline(text)}</h${depth}>`;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderMarkdown(md: string): string {
  headingIds.clear();
  return marked.parse(md, { renderer }) as string;
}

function header(activeHref: string, depth: number): string {
  const prefix = '../'.repeat(depth);
  const nav = NAV.map((item) => {
    const isExternal = item.href.startsWith('http');
    const href = isExternal ? item.href : item.href === './' ? prefix || './' : prefix + item.href;
    const isActive = !isExternal && item.href === activeHref;
    return `<a href="${href}"${isActive ? ' aria-current="page"' : ''}>${item.label}</a>`;
  }).join('');
  return `<header class="site-header">
    <a href="${prefix || './'}" class="site-brand"><span class="brand-mark"><span></span><span></span><span></span></span> BDI Kerncomponenten</a>
    <nav class="site-nav">${nav}</nav>
  </header>`;
}

function footer(): string {
  return `<footer class="site-footer">
    <span>PolyForm Shield 1.0.0 · Transportial &amp; contributors · <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>`;
}

function docLayout(params: {
  title: string;
  body: string;
  sidebar: string;
  depth: number;
  activeHref: string;
}): string {
  const prefix = '../'.repeat(params.depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${params.title} — BDI Kerncomponenten</title>
  <link rel="stylesheet" href="${prefix}assets/site.css" />
</head>
<body>
  ${header(params.activeHref, params.depth)}
  <main class="docs-layout">
    <aside class="docs-sidebar">${params.sidebar}</aside>
    <article class="docs-main">${params.body}</article>
  </main>
  ${footer()}
</body>
</html>`;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function buildDocPages(): Promise<void> {
  await ensureDir(OUT_DOCS);
  const adrEntries = existsSync(ADR_DIR)
    ? (await readdir(ADR_DIR)).filter((f) => f.endsWith('.md')).sort()
    : [];

  const makeSidebar = (guidesPrefix: string, adrPrefix: string): string => `
    <h4>Guides</h4>
    <ul>
      ${DOC_PAGES.map((p) => `<li><a href="${guidesPrefix}${basename(p.file, '.md')}.html">${p.title}</a></li>`).join('')}
    </ul>
    <h4>Architecture decisions</h4>
    <ul>
      ${adrEntries
        .map((f) => {
          const name = basename(f, '.md');
          return `<li><a href="${adrPrefix}${name}.html">${name}</a></li>`;
        })
        .join('')}
    </ul>
  `;
  const sidebar = makeSidebar('', 'adr/');
  const adrSidebar = makeSidebar('../', '');

  for (const page of DOC_PAGES) {
    const md = await readFile(join(DOCS_DIR, page.file), 'utf8');
    const body = renderMarkdown(md);
    const html = docLayout({
      title: page.title,
      body,
      sidebar,
      depth: 1,
      activeHref: 'docs/',
    });
    await writeFile(join(OUT_DOCS, `${basename(page.file, '.md')}.html`), html);
  }

  // Landing page for /docs/
  const docIndexBody = `
    <h1>Documentation</h1>
    <p class="muted">Long-form guides, security policy, and architecture decision records.</p>
    <h2>Guides</h2>
    <ul>
      ${DOC_PAGES.map((p) => `<li><a href="${basename(p.file, '.md')}.html"><strong>${p.title}</strong></a></li>`).join('')}
    </ul>
    <h2>Architecture decisions</h2>
    <ul>
      ${adrEntries
        .map((f) => {
          const name = basename(f, '.md');
          return `<li><a href="adr/${name}.html">${name.replace(/-/g, ' ')}</a></li>`;
        })
        .join('')}
    </ul>
  `;
  await writeFile(
    join(OUT_DOCS, 'index.html'),
    docLayout({
      title: 'Docs',
      body: docIndexBody,
      sidebar,
      depth: 1,
      activeHref: 'docs/',
    }),
  );

  // ADRs
  if (adrEntries.length > 0) {
    await ensureDir(join(OUT_DOCS, 'adr'));
    for (const f of adrEntries) {
      const md = await readFile(join(ADR_DIR, f), 'utf8');
      const body = renderMarkdown(md);
      const name = basename(f, '.md');
      const html = docLayout({
        title: name,
        body,
        sidebar: adrSidebar,
        depth: 2,
        activeHref: 'docs/',
      });
      await writeFile(join(OUT_DOCS, 'adr', `${name}.html`), html);
    }
  }
}

async function buildApiPages(): Promise<void> {
  await ensureDir(OUT_API);
  const services = ['asr', 'ors', 'con'];
  for (const svc of services) {
    const json = await readFile(join(API_DIR, `${svc}.json`), 'utf8');
    const yaml = await readFile(join(API_DIR, `${svc}.yaml`), 'utf8');
    await writeFile(join(OUT_API, `${svc}.json`), json);
    await writeFile(join(OUT_API, `${svc}.yaml`), yaml);

    const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${svc.toUpperCase()} API — BDI Kerncomponenten</title>
  <link rel="stylesheet" href="../assets/site.css" />
  <style>
    body, html { height: 100%; }
    .api-body { padding: 0; }
    .api-toolbar {
      display: flex; gap: 12px; align-items: center;
      padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--panel);
    }
    .api-toolbar a { color: var(--muted); font-size: 14px; padding: 6px 10px; border-radius: 6px; }
    .api-toolbar a:hover { background: var(--accent-soft); color: var(--fg); text-decoration: none; }
    .api-toolbar a[aria-current="page"] { color: var(--fg); background: var(--accent-soft); }
  </style>
</head>
<body>
  ${header('api/asr.html', 1)}
  <div class="api-toolbar">
    <strong>API:</strong>
    ${services
      .map(
        (s) =>
          `<a href="${s}.html"${s === svc ? ' aria-current="page"' : ''}>${s.toUpperCase()}</a>`,
      )
      .join('')}
    <span style="flex:1"></span>
    <a href="${svc}.json" download>Download JSON</a>
    <a href="${svc}.yaml" download>Download YAML</a>
  </div>
  <script id="api-reference" data-url="./${svc}.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>
    document.getElementById('api-reference').dataset.configuration = JSON.stringify({
      theme: 'deepSpace',
      layout: 'modern',
      hideDownloadButton: true,
    });
  </script>
  ${footer()}
</body>
</html>`;
    await writeFile(join(OUT_API, `${svc}.html`), page);
  }
}

async function buildSitemap(): Promise<void> {
  // Crawler-facing artefacts: sitemap.xml lists every page the build emits;
  // robots.txt advertises it. Static-asset URLs (.json/.yaml downloads,
  // /assets/*) are deliberately omitted — they aren't pages to index.
  const adrs = existsSync(ADR_DIR)
    ? (await readdir(ADR_DIR)).filter((f) => f.endsWith('.md')).sort()
    : [];

  const urls: string[] = [
    '',                          // homepage
    'architecture.html',
    'interactive/',
    'docs/',
    ...DOC_PAGES.map((p) => `docs/${basename(p.file, '.md')}.html`),
    ...adrs.map((f) => `docs/adr/${basename(f, '.md')}.html`),
    'api/asr.html',
    'api/ors.html',
    'api/con.html',
  ];

  const lastmod = new Date().toISOString().slice(0, 10);
  const entries = urls
    .map((u) => `  <url><loc>${BASE_URL}${u}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
  await writeFile(join(SITE_DIR, 'sitemap.xml'), sitemap);

  const robots = `User-agent: *
Allow: /

Sitemap: ${BASE_URL}sitemap.xml
`;
  await writeFile(join(SITE_DIR, 'robots.txt'), robots);
}

async function copyTemplates(): Promise<void> {
  for (const entry of await readdir(SITE_DIR)) {
    if (entry.endsWith('.html.tpl')) {
      const src = join(SITE_DIR, entry);
      const dst = join(SITE_DIR, entry.replace(/\.tpl$/, ''));
      await copyFile(src, dst);
    }
  }
}

function ensureInteractive(): void {
  // docs/site/interactive/ is authored directly; nothing to generate.
  if (!existsSync(join(SITE_DIR, 'interactive', 'index.html'))) {
    throw new Error('Interactive explorer is missing');
  }
}

async function main(): Promise<void> {
  console.log('• building docs site in', relative(ROOT, SITE_DIR));
  ensureInteractive();
  await copyTemplates();
  await buildDocPages();
  await buildApiPages();
  await buildSitemap();
  console.log('  ✔ docs pages:   docs/site/docs/*.html');
  console.log('  ✔ api pages:    docs/site/api/*.html');
  console.log('  ✔ interactive:  docs/site/interactive/');
  console.log('  ✔ templates:    docs/site/*.html');
  console.log('  ✔ crawlers:     docs/site/sitemap.xml + robots.txt');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
