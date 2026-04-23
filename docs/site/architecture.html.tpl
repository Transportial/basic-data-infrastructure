<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Architecture — BDI Kerncomponenten</title>
  <link rel="stylesheet" href="assets/site.css" />
</head>
<body>
  <header class="site-header">
    <a href="./" class="site-brand">BDI Kerncomponenten</a>
    <nav class="site-nav">
      <a href="./">Overview</a>
      <a href="architecture.html" aria-current="page">Architecture</a>
      <a href="interactive/">Interactive</a>
      <a href="api/asr.html">API</a>
      <a href="docs/">Docs</a>
      <a href="https://github.com/transportial/basic-data-infrastructure">GitHub</a>
    </nav>
  </header>

  <main class="content">
    <h1>Architecture at a glance</h1>
    <p class="muted">
      Three services, a handful of shared packages, one rigorously-enforced
      dependency direction. The canonical long-form description lives in
      <a href="docs/ARCHITECTURE.html">docs/ARCHITECTURE</a>; this page is the
      sketch.
    </p>

    <h2>The map</h2>
    <p>
      The interactive explorer is the most productive way to look around:
    </p>
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin: 16px 0 24px 0;">
      <a class="btn" href="interactive/">Open the interactive explorer →</a>
      <a class="btn ghost" href="docs/ARCHITECTURE.html">Read the written doc</a>
    </div>

    <h2 id="asr">ASR — Associatie Register</h2>
    <p>
      Governs <em>who</em> can participate. Two core aggregates:
    </p>
    <ul>
      <li><code>Member</code> — onboarding, KvK/KBO/GLEIF/VIES verification,
        signing-representative eHerkenning check, 4-eyes approval, status transitions.</li>
      <li><code>Connector</code> — registration, kid/JWK binding, X.509 cert
        thumbprint pinning, status transitions.</li>
    </ul>
    <p>
      Issues the <strong>BVAD</strong> (Bewijs van Associatie-Deelname) to
      connectors against RFC 7523 client assertions, signs the trustlist for
      the association, and performs RFC 8693 token exchange with federated
      peer associations.
    </p>

    <h2 id="ors">ORS — Orkestratie Register</h2>
    <p>
      Governs <em>what</em> happens in a logistics chain. Aggregate:
    </p>
    <ul>
      <li><code>ChainContext</code> — identifiers (BOL, AWB, …), parties and
        their roles, delegations, role-bound natural persons (stored as
        SHA-256 pseudonyms, never as PII).</li>
    </ul>
    <p>
      Issues the <strong>BVOD</strong> (Bewijs van Orkestratie-Deelname)
      scoped to (context, subject connector) and pushes events to subscribed
      connectors via Valkey Streams.
    </p>

    <h2 id="con">CON — BDI Connector</h2>
    <p>
      Runs alongside each member's application. Full token verification
      pipeline on inbound, backoff-based delivery on outbound, a reverse
      proxy for legacy upstreams, and pluggable PDP adapters
      (Cedar / OPA / Keycloak-Authz).
    </p>

    <h2>Shared packages</h2>
    <table>
      <thead>
        <tr><th>Package</th><th>Responsibility</th></tr>
      </thead>
      <tbody>
        <tr><td><code>@bdi/kernel</code></td><td>Result, branded types, EUID/LEI/VAT/KvK parsers, JWK &amp; thumbprint helpers.</td></tr>
        <tr><td><code>@bdi/contracts</code></td><td>Wire schemas for BVAD, BVOD, trustlist, member descriptor.</td></tr>
        <tr><td><code>@bdi/crypto</code></td><td>BDI JWS profile, RFC 7523 verifier, key generation, HSM/PKCS#11/step-ca.</td></tr>
        <tr><td><code>@bdi/crypto-ca</code></td><td>RFC 8555 ACME server + client, CSR parser, X.509 issuer, OCSP, CRL.</td></tr>
        <tr><td><code>@bdi/identity</code></td><td>Keycloak OIDC verifier, eHerkenning SAML broker, <code>AuthnPort</code>.</td></tr>
        <tr><td><code>@bdi/events</code></td><td>Typed events, Valkey Streams consumer, rate limiter, scheduler.</td></tr>
        <tr><td><code>@bdi/policy</code></td><td>PDP port + embedded Cedar-like engine + external adapters.</td></tr>
        <tr><td><code>@bdi/config</code></td><td>Env parsing, <code>*_FILE</code> secrets, SIGHUP hot-reload, migrations, RLS, YAML.</td></tr>
        <tr><td><code>@bdi/observability</code></td><td>Structured logs, metrics registry, trace context, OTLP exporter.</td></tr>
        <tr><td><code>@bdi/openapi</code></td><td>OpenAPI 3.1 document builder used by <code>scripts/generate-openapi.ts</code>.</td></tr>
      </tbody>
    </table>

    <h2>Data plane vs. trust plane</h2>
    <p>
      The interactive explorer draws these as three horizontal bands:
    </p>
    <ul>
      <li><strong>Trust plane</strong> — ASR and its satellites (IdP, registries, CA, peer ASR).</li>
      <li><strong>Orchestration plane</strong> — ORS and its subscriptions.</li>
      <li><strong>Data plane</strong> — Connector-to-Connector traffic plus the outbound upstreams.</li>
    </ul>
    <p>
      Tokens issued in the trust plane (BVAD) and orchestration plane (BVOD)
      are what the data plane verifies. This keeps the runtime data plane
      ignorant of identity providers and registries — it only needs the
      ASR's trustlist and the ORS's public keys.
    </p>
  </main>

  <footer class="site-footer">
    <span>EUPL 1.2 · Stichting Connekt &amp; contributors · <a href="https://github.com/transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
