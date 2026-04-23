<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BDI Kerncomponenten — Reference implementation</title>
  <meta name="description" content="Reference implementation of BDI Kerncomponenten (TN-559705): ASR, ORS, CON." />
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
      <a href="https://github.com/transportial/basic-data-infrastructure">GitHub</a>
    </nav>
  </header>

  <section class="hero">
    <h1>BDI Kerncomponenten</h1>
    <p class="lede">
      A reference implementation of the three core components of the Basis
      Data Infrastructuur (TN-559705): the Associatie Register (ASR), the
      Orkestratie Register (ORS), and the BDI Connector (CON). Open source
      under EUPL 1.2.
    </p>
    <div class="hero-cta">
      <a href="interactive/" class="btn">Explore interactively</a>
      <a href="docs/SETUP.html" class="btn ghost">Quick start</a>
      <a href="api/asr.html" class="btn ghost">API reference</a>
    </div>
  </section>

  <section class="features">
    <div class="feature">
      <h3>TypeScript + Bun</h3>
      <p>Monorepo on Bun 1.3. No bundler gymnastics, no transpile step. Tests, TS, SQLite and Valkey clients all ship in the runtime.</p>
    </div>
    <div class="feature">
      <h3>Clean architecture</h3>
      <p>Each service is layered domain → application → infrastructure → interface. Ports & adapters everywhere. No framework-driven magic.</p>
    </div>
    <div class="feature">
      <h3>Cryptography you can audit</h3>
      <p>EdDSA/ES256/PS256 only. BDI JWS profile with crit header. RFC 7523 client assertions. Real ACME server + client. X.509 via DER/ASN.1.</p>
    </div>
    <div class="feature">
      <h3>Production ports</h3>
      <p>Postgres + RLS, Valkey streams, HSM/PKCS#11, OIDC/SAML identity, Cedar/OPA/Keycloak PDPs, OTLP. Swappable at the composition root.</p>
    </div>
  </section>

  <section class="content">
    <h2>The three components</h2>
    <div class="cards">
      <a class="card" href="architecture.html#asr">
        <h3>ASR — Associatie Register</h3>
        <p>Governs <em>who</em> can participate. Member onboarding, 4-eyes approval, connector binding, trustlist, BVAD issuance, RFC 8693 federation.</p>
      </a>
      <a class="card" href="architecture.html#ors">
        <h3>ORS — Orkestratie Register</h3>
        <p>Governs <em>what</em> happens in a chain. Chain contexts, delegations, pseudonymised natural persons, BVOD issuance, event subscriptions.</p>
      </a>
      <a class="card" href="architecture.html#con">
        <h3>CON — Connector</h3>
        <p>Runs at each member. Validates inbound BVAD + BVOD, runs the PDP, dispatches outbound webhooks with backoff, handles proxy forwarding.</p>
      </a>
    </div>

    <h2>Try it in 60 seconds</h2>
    <pre><code># Install Bun 1.3+
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/transportial/basic-data-infrastructure.git
cd basic-data-infrastructure
bun install

# Run every test (offline, no external services)
bun test

# Boot any service
bun run --filter '@bdi/asr' dev
bun run --filter '@bdi/ors' dev
bun run --filter '@bdi/con' dev</code></pre>

    <h2>What's inside</h2>
    <div class="cards">
      <a class="card" href="interactive/">
        <h3>Interactive explorer &rarr;</h3>
        <p>Click through the components, run animated flows for onboarding, BVAD/BVOD issuance, webhook delivery and federation.</p>
      </a>
      <a class="card" href="api/asr.html">
        <h3>OpenAPI references &rarr;</h3>
        <p>Browse the ASR, ORS and CON HTTP contracts rendered with Scalar. Try requests straight from the page.</p>
      </a>
      <a class="card" href="docs/">
        <h3>Written docs &rarr;</h3>
        <p>Architecture, setup, contribution guide, security policy, and the architecture decision records.</p>
      </a>
    </div>
  </section>

  <footer class="site-footer">
    <span>EUPL 1.2 · Transportial &amp; contributors · <a href="https://github.com/transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
