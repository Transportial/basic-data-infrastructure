<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BDI Kerncomponenten — Trusted data sharing for supply chains</title>
  <meta name="description" content="Open-source reference implementation of the Basis Data Infrastructuur. Run it locally in 60 seconds; deploy it in production." />
  <link rel="stylesheet" href="assets/site.css" />
</head>
<body>
  <header class="site-header">
    <a href="./" class="site-brand">BDI Kerncomponenten</a>
    <nav class="site-nav">
      <a href="./" aria-current="page">Overview</a>
      <a href="architecture.html">Architecture</a>
      <a href="interactive/">Interactive</a>
      <a href="api/asr.html">API</a>
      <a href="docs/">Docs</a>
      <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a>
    </nav>
  </header>

  <section class="hero">
    <h1>Trusted data sharing<br/>across every link in the chain.</h1>
    <p class="lede">
      The <strong>Basis Data Infrastructuur</strong> lets carriers, shippers,
      terminals and platforms exchange shipment data without a central
      middleman — using a small set of open protocols and signed envelopes
      that each party can verify offline. This is the open-source reference
      implementation. Run it on your laptop in 60 seconds; deploy it in
      production with the same code.
    </p>
    <div class="hero-cta">
      <a href="interactive/" class="btn">See it in action</a>
      <a href="#install-from-npm" class="btn ghost">Install from npm</a>
      <a href="api/asr.html" class="btn ghost">Browse the API</a>
    </div>
  </section>

  <section class="content">
    <h2>What problem does BDI solve?</h2>
    <p>
      A single shipment touches a dozen organisations before it reaches its
      destination. Each one holds part of the truth — a booking number, a
      customs declaration, a temperature log — but turning those fragments
      into a coherent picture today means dozens of bilateral integrations,
      hand-shared API keys, and a lot of email.
    </p>
    <p>
      BDI replaces that pile of one-off connections with three small,
      well-defined services. Once a member is admitted to the network and
      a chain context is opened, any two participants can exchange data
      directly, knowing the other side is who they say they are and is
      authorised to take part. The registers stay out of the data plane;
      decisions are made locally, against signed evidence.
    </p>
  </section>

  <section class="features">
    <div class="feature">
      <h3>Built for production, friendly to prototype</h3>
      <p>The same TypeScript codebase runs in-memory for tests and against Postgres, Valkey, an HSM and your IdP in production. Adapters swap without touching domain code.</p>
    </div>
    <div class="feature">
      <h3>Clean architecture you can read</h3>
      <p>Each service is layered domain → application → infrastructure → interface. Ports and adapters everywhere. No framework magic, no surprise dependencies.</p>
    </div>
    <div class="feature">
      <h3>Cryptography you can audit</h3>
      <p>EdDSA / ES256 / PS256 only. BDI JWS profile with a strict <code>crit</code> header. RFC 7523 client assertions. A real ACME server and client. X.509 down to the DER bytes.</p>
    </div>
    <div class="feature">
      <h3>Open under EUPL 1.2</h3>
      <p>Free for public agencies and commercial operators alike. Contracts are additionally dual-licensed Apache 2.0 so anyone can build compatible implementations.</p>
    </div>
  </section>

  <section class="content">
    <h2>The three components, in plain language</h2>
    <div class="cards">
      <a class="card" href="architecture.html#asr">
        <h3>ASR — the membership office</h3>
        <p>Decides <em>who</em> can participate. Onboards new members, verifies them against KvK / KBO / GLEIF / VIES, applies 4-eyes approval, and issues each member a signed identity envelope (BVAD).</p>
      </a>
      <a class="card" href="architecture.html#ors">
        <h3>ORS — the choreographer</h3>
        <p>Decides <em>what</em> happens in a chain. Sets up shipment contexts, delegations and pseudonymised actors, and issues a signed envelope (BVOD) that says which parties may exchange data for that specific chain.</p>
      </a>
      <a class="card" href="architecture.html#con">
        <h3>CON — the doorman at each member</h3>
        <p>Runs at every participating organisation. Validates inbound BVAD + BVOD, asks a local policy engine for the final allow/deny, and dispatches outbound webhooks with retries and backoff.</p>
      </a>
    </div>

    <h2 id="install-from-npm">Install from npm</h2>
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

    <h2>Or hack on the source in 60 seconds</h2>
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

    <h2>Where to go next</h2>
    <div class="cards">
      <a class="card" href="interactive/">
        <h3>Interactive explorer &rarr;</h3>
        <p>Click through the components and watch animated flows for member onboarding, BVAD and BVOD issuance, webhook delivery, and cross-register federation.</p>
      </a>
      <a class="card" href="api/asr.html">
        <h3>OpenAPI references &rarr;</h3>
        <p>Browse the ASR, ORS and CON HTTP contracts rendered with Scalar. Try requests straight from the page — no signup, no account.</p>
      </a>
      <a class="card" href="docs/">
        <h3>Written docs &rarr;</h3>
        <p>Architecture, setup, contribution guide, security policy, and the architecture decision records that explain why things are the way they are.</p>
      </a>
    </div>

    <h2>Who is this for?</h2>
    <p>
      Engineers at logistics platforms, carriers and terminals evaluating BDI
      for a real integration. Public-sector teams working on national or
      sectoral data spaces. Researchers and students who want a working,
      auditable example of a modern federated data-sharing protocol. Anyone
      building on EU data-space concepts — much of the trust machinery here
      applies directly to Gaia-X, IDSA and EONA-X.
    </p>
    <p>
      Questions, contributions and "this surprised me" reports are all
      welcome on <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a>.
    </p>
  </section>

  <footer class="site-footer">
    <span>EUPL 1.2 · Transportial &amp; contributors · <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
