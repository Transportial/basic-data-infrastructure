<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BDI Kerncomponenten — Federated, chain-of-custody data exchange</title>
  <meta name="description" content="A source-available toolkit for trusted, federated data exchange between parties that share a chain of custody. Reference implementation of the Dutch Basis Data Infrastructuur (BDI), generalisable to logistics, healthcare, finance, energy and beyond." />
  <script>try{var t=localStorage.getItem('bdi-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}</script>
  <link rel="stylesheet" href="assets/site.css" />
  <script src="assets/theme.js" defer></script>
</head>
<body>
  <header class="site-header">
    <a href="./" class="site-brand">
      <span class="brand-mark"><span></span><span></span><span></span></span>
      BDI Kerncomponenten
    </a>
    <button type="button" id="nav-toggle" class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="site-nav">
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
    </button>
    <nav class="site-nav" id="site-nav">
      <a href="./" aria-current="page">Overview</a>
      <a href="architecture.html">Architecture</a>
      <a href="recipes.html">Recipes</a>
      <a href="interactive/">Interactive</a>
      <a href="api/asr.html">API</a>
      <a href="docs/">Docs</a>
      <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle dark/light theme" title="Toggle theme">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </nav>
  </header>

  <section class="hero">
    <div class="hero-inner">
      <span class="eyebrow"><span class="dot"></span>Reference implementation · v0.1.0 · PolyForm Shield 1.0.0</span>
      <h1>Trusted data exchange<br/>between parties that <em>share a chain</em>.</h1>
      <p class="lede">
        A source-available toolkit for federated data exchange — no central
        middleman in the data plane, no platform lock-in. Implements the Dutch
        <strong>Basis Data Infrastructuur (BDI)</strong> as its canonical
        conformance profile, but the mechanism generalises to any domain
        where multiple independent parties need cryptographically verifiable
        trust. Run the three components on your laptop in 60 seconds; deploy
        them in production with the same code.
      </p>
      <div class="hero-cta">
        <a href="interactive/" class="btn">See it in action</a>
        <a href="#install-from-npm" class="btn ghost">Install from npm</a>
        <a href="api/asr.html" class="btn ghost">Browse the API</a>
      </div>
    </div>
  </section>

  <section class="features">
    <div class="feature">
      <span class="feature-num">01 · Production-ready</span>
      <h3>Built for production, friendly to prototype</h3>
      <p>The same TypeScript codebase runs in-memory for tests and against Postgres, Valkey, an HSM and your IdP in production. Adapters swap without touching domain code.</p>
    </div>
    <div class="feature">
      <span class="feature-num">02 · Layered</span>
      <h3>Clean architecture you can read</h3>
      <p>Each service is layered domain → application → infrastructure → interface. Ports and adapters everywhere. No framework magic, no surprise dependencies.</p>
    </div>
    <div class="feature">
      <span class="feature-num">03 · Verifiable</span>
      <h3>Cryptography you can audit</h3>
      <p>EdDSA / ES256 / PS256 only. BDI JWS profile with a strict <code>crit</code> header. RFC 7523 client assertions. A real ACME server and client. X.509 down to the DER bytes.</p>
    </div>
    <div class="feature">
      <span class="feature-num">04 · Source-available</span>
      <h3>Commercial-friendly licence</h3>
      <p>PolyForm Shield 1.0.0: free to adopt, fork, run internally, and integrate into your own products — including commercially. Wire-format schemas are additionally Apache 2.0.</p>
    </div>
  </section>

  <section class="content">
    <h2><span class="sigil">§1</span>What is this, and why should you care?</h2>
    <p>
      Whenever multiple organisations need to coordinate on the same
      underlying <em>thing</em> — a shipment, a patient referral, a customs
      declaration, a financial settlement, an energy-grid dispatch, a
      regulatory filing — each party usually holds a fragment of the truth.
      Stitching those fragments together is slow, expensive, and dominated
      by one-off bilateral integrations.
    </p>
    <p>
      The pattern that solves it is older than any one industry: agree on a
      tiny set of <strong>protocols</strong> instead of forcing everyone
      onto a single <strong>platform</strong>. Two parties who have never
      met before share data about a shared object <em>once they prove they
      belong together in a chain of custody</em>, with cryptographic
      guarantees, and without a central operator sitting in the request path.
    </p>
    <p>
      This repository implements that pattern. Concretely, it is a reference
      implementation of the BDI — the Dutch national initiative that
      originated this design for logistics and supply chains — but the
      mechanism (federated identity register, chain-of-custody token issuer,
      local policy enforcement at each member) applies to any domain where:
    </p>
    <ul>
      <li>multiple independent parties need to exchange data,</li>
      <li>membership and counterparty trust must be cryptographically verifiable,</li>
      <li>a specific exchange is bounded by a <em>chain</em> — referral pathway,
          shipment, custody chain, transaction graph, regulatory case file,</li>
      <li>and no single party can — for legal, competitive, or operational
          reasons — be the central data hub.</li>
    </ul>

    <h2><span class="sigil">§2</span>The three components, in plain language</h2>
    <p>
      The protocol splits the responsibility for a data exchange into three
      small services. Each does one thing well, and each can be operated by
      a different party. The names are BDI's; the roles are domain-neutral.
    </p>
    <div class="spec-sheet">
      <a class="spec-card" href="architecture.html#asr">
        <span class="num">01 · ASR</span>
        <h3>The membership office</h3>
        <p>Decides <strong>who</strong> can participate. Onboards new members, verifies them against authoritative sources, applies 4-eyes approval, and issues each member a signed identity envelope (<span class="token">BVAD</span>) that other parties verify offline against a published trustlist. Verifier interface is pluggable — KvK / KBO / GLEIF / VIES, or whatever your domain needs.</p>
      </a>
      <a class="spec-card" href="architecture.html#ors">
        <span class="num">02 · ORS</span>
        <h3>The choreographer</h3>
        <p>Decides <strong>what</strong> happens in a particular chain. Shipments, referral pathways, delegated mandates, multi-leg settlements, regulatory cases — all are <em>chain contexts</em>. Issues a signed envelope (<span class="token">BVOD</span>) that says "for this case, these specific parties may exchange data."</p>
      </a>
      <a class="spec-card" href="architecture.html#con">
        <span class="num">03 · CON</span>
        <h3>The doorman at each member</h3>
        <p>Runs at every participating organisation. Validates inbound <span class="token">BVAD</span> + <span class="token">BVOD</span> against a cached trustlist, asks a local policy engine for the final allow/deny, and dispatches outbound webhooks with retries. Decisions happen <em>locally</em> — neither register sits in the data plane.</p>
      </a>
    </div>
    <blockquote>
      <strong>Why the dual-token boundary matters.</strong> Most data-sharing
      platforms put the operator in the middle of every call — and therefore
      see, log, and potentially leak every payload. This design deliberately
      doesn't. Connectors verify cryptographic envelopes against a cached
      trustlist, so the registers can be temporarily unreachable without
      stopping legitimate traffic — and they never see the payloads at all.
    </blockquote>

    <h2 id="install-from-npm"><span class="sigil">§3</span>Install from npm</h2>
    <p>
      The three core services are published to npm under the
      <a href="https://www.npmjs.com/org/transportial"><code>@transportial</code></a>
      scope and run on Node ≥20 or Bun ≥1.2. Every component ships both a
      CLI binary and a library entry point, with full TypeScript types.
    </p>
    <h3>Run a service straight from the CLI</h3>
    <pre><code># Associatie Register on :8080
PORT=8080 npx -y @transportial/asr

# Orkestratie Register on :8081
PORT=8081 npx -y @transportial/ors

# Connector on :8443
PORT=8443 npx -y @transportial/con</code></pre>
    <p>
      Common environment variables: <code>PORT</code>, <code>ASR_ISSUER</code>,
      <code>ORS_ISSUER</code>, <code>ASSOCIATION_ID</code>,
      <code>CONNECTOR_ID</code>, <code>CON_AUDIENCE</code>. See
      <a href="docs/SETUP.html">Setup</a> for the full list and production notes.
    </p>

    <h3 id="bootstrap-an-association">Bootstrap a full association deployment</h3>
    <p>
      If you're standing up the registers (ASR + ORS) for a new association
      rather than running a single service, the bundled <code>bdi</code> CLI
      generates a complete deployment directory in one step:
    </p>
    <pre><code>bunx -p @transportial/cli bdi init-association \
  --id eu.nl.bdi.acme \
  --name "Acme Logistics Association" \
  --domain bdi.acme.example \
  --admin-email ops@acme.example \
  --out ./acme-deploy

cd ./acme-deploy &amp;&amp; docker compose up -d</code></pre>
    <p>The generated directory contains:</p>
    <ul>
      <li><code>compose.yml</code> — Postgres, Valkey, Keycloak, ASR, ORS (member-side connectors install separately).</li>
      <li><code>.env.asr</code> and <code>.env.ors</code> — pre-filled with the association id, signing kid, DB credentials, and issuer URLs.</li>
      <li><code>keys/</code> — freshly generated EdDSA signing JWKs for ASR and ORS.</li>
      <li><code>db/init-multi-db.sh</code> — bootstraps <code>asr_db</code> and <code>ors_db</code> on first start.</li>
      <li><code>admin/bootstrap.json</code> — single-use credential to claim the first admin account in Keycloak.</li>
      <li><code>README.md</code> — exact next-step commands for inviting your first member.</li>
    </ul>
    <p>
      The generator refuses to overwrite an existing deployment, so it's safe
      to re-run while you tweak flags. Private signing keys land on disk and
      are acceptable for development; for production, swap them for HSM- or
      PKCS#11-backed signing as documented in the generated README.
    </p>

    <h3>Embed as a library</h3>
    <pre><code>npm install @transportial/asr
# or: bun add @transportial/asr</code></pre>
    <pre><code>import { createServer } from '@transportial/asr';

const { fetch, composition } = await createServer({
  port: 8080,
  issuer: 'https://asr.example.org',
});

// Bun
Bun.serve({ port: 8080, fetch });</code></pre>
    <p>
      <code>@transportial/ors</code> and <code>@transportial/con</code> expose
      the same <code>createServer</code> shape. The shared building blocks —
      <code>kernel</code>, <code>contracts</code>, <code>crypto</code>,
      <code>crypto-ca</code>, <code>events</code>, <code>observability</code>,
      <code>identity</code>, <code>policy</code>, <code>config</code>,
      <code>testing</code>, <code>openapi</code> — are published alongside
      and can be consumed independently.
    </p>

    <h2><span class="sigil">§4</span>Or hack on the source in 60 seconds</h2>
    <p>
      No database to install, no broker to configure, no keys to generate.
      The reference adapters are real implementations that simply keep state
      in memory, so the entire test suite is offline and self-contained.
    </p>
    <pre><code># Install Bun 1.3+
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/Transportial/basic-data-infrastructure.git
cd basic-data-infrastructure
bun install

# Run every test (offline, no external services)
bun test

# Boot any service
bun run --filter '@transportial/asr' dev
bun run --filter '@transportial/ors' dev
bun run --filter '@transportial/con' dev</code></pre>

    <h2><span class="sigil">§5</span>Where to go next</h2>
    <div class="cards">
      <a class="card" href="recipes.html">
        <h3>Domain recipes →</h3>
        <p>Optional add-ons that teach the connector about real data shapes — OTM 5.8 for transport today, eFTI / FHIR / ISO 20022 on the roadmap. Validate, tag, and route domain payloads without putting a schema in your backend.</p>
      </a>
      <a class="card" href="interactive/">
        <h3>Interactive explorer →</h3>
        <p>Click through the components and watch animated flows for member onboarding, BVAD and BVOD issuance, webhook delivery, and cross-register federation.</p>
      </a>
      <a class="card" href="api/asr.html">
        <h3>OpenAPI references →</h3>
        <p>Browse the ASR, ORS and CON HTTP contracts rendered with Scalar. Try requests straight from the page — no signup, no account.</p>
      </a>
      <a class="card" href="docs/">
        <h3>Written docs →</h3>
        <p>Architecture, setup, contribution guide, security policy, and the architecture decision records that explain why things are the way they are.</p>
      </a>
    </div>

    <h2><span class="sigil">§6</span>Who is this for?</h2>
    <ul>
      <li><strong>Logistics, transport, and supply-chain integrators</strong> — the originating use case for BDI, and still the most direct fit (carriers, shippers, terminals, customs brokers, platform operators).</li>
      <li><strong>Healthcare and public-health networks</strong> building referral pathways, cross-institution patient data exchange, or clinical-research collaborations across hospitals, GPs, payers, and regulators.</li>
      <li><strong>Financial settlement, KYC, and trade-finance networks</strong> where multiple institutions must coordinate on a transaction graph without one party becoming the central operator.</li>
      <li><strong>Energy, utilities, and grid-balancing operators</strong> sharing dispatch, metering, or congestion data across TSOs, DSOs, aggregators, and prosumers.</li>
      <li><strong>Regulatory and compliance reporting chains</strong> — supervisor, supervised entity, auditor, sectoral register — where authenticity and provenance must be verifiable end-to-end.</li>
      <li><strong>Public-sector teams</strong> building national or sectoral data spaces, and anyone building on EU data-space concepts (Gaia-X, IDSA, EONA-X) — the trust machinery here maps directly onto those frameworks.</li>
      <li><strong>Researchers and students</strong> who want a working, auditable example of a modern federated data-sharing protocol to study or extend.</li>
    </ul>
    <p>
      Contributions, questions, and "this surprised me" reports are all
      welcome on <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a>.
    </p>
  </section>

  <footer class="site-footer">
    <span>PolyForm Shield 1.0.0 · Transportial &amp; contributors · <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
