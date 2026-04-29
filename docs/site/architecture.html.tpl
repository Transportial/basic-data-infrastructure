<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>How BDI fits together — Architecture</title>
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
    <h1>How BDI fits together</h1>
    <p class="muted">
      Three small services, a handful of shared packages, and one
      strictly-enforced rule about which way dependencies are allowed to
      point. This page is the visual sketch — for the long-form deep-dive,
      head to <a href="docs/ARCHITECTURE.html">docs/ARCHITECTURE</a>.
    </p>

    <h2>The fastest way to look around</h2>
    <p>
      If you'd rather click through the system than read about it, the
      interactive explorer is the better starting point. You can run animated
      flows for member onboarding, BVAD/BVOD issuance, webhook delivery, and
      cross-association federation, and see exactly which messages cross
      which boundary.
    </p>
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin: 16px 0 24px 0;">
      <a class="btn" href="interactive/">Open the interactive explorer →</a>
      <a class="btn ghost" href="docs/ARCHITECTURE.html">Read the written doc</a>
    </div>

    <h2 id="asr">ASR — the membership office</h2>
    <p>
      The ASR governs <em>who</em> is allowed to participate. Two core
      aggregates carry the weight:
    </p>
    <ul>
      <li><code>Member</code> — onboarding, KvK / KBO / GLEIF / VIES verification,
        signing-representative eHerkenning check, 4-eyes approval, and the
        full status state machine.</li>
      <li><code>Connector</code> — registration, kid/JWK binding, X.509
        certificate-thumbprint pinning, and status transitions.</li>
    </ul>
    <p>
      The ASR issues the <strong>BVAD</strong> (Bewijs van Associatie-Deelname)
      to connectors against RFC 7523 client assertions, signs the trustlist
      for the association, and performs RFC 8693 token exchange with
      federated peer associations.
    </p>

    <h2 id="ors">ORS — the choreographer</h2>
    <p>
      The ORS governs <em>what's happening right now</em> in a logistics
      chain. Its single aggregate is:
    </p>
    <ul>
      <li><code>ChainContext</code> — identifiers (BOL, AWB, …), parties and
        their roles, delegations, and role-bound natural persons (stored as
        SHA-256 pseudonyms; never as PII).</li>
    </ul>
    <p>
      It issues the <strong>BVOD</strong> (Bewijs van Orkestratie-Deelname),
      scoped to a specific (context, subject connector) pair, and pushes
      events to subscribed connectors via Valkey Streams.
    </p>

    <h2 id="con">CON — the doorman at each member</h2>
    <p>
      The connector runs alongside each member's application. It handles a
      full token-verification pipeline on inbound traffic, dispatches
      outbound webhooks with backoff, acts as a reverse proxy for legacy
      upstreams, and supports pluggable PDP adapters
      (Cedar / OPA / Keycloak-Authz). Critically, <strong>every allow/deny
      decision happens locally</strong> — neither register sees payloads.
    </p>

    <h2>Shared packages</h2>
    <p>
      The shared packages aren't just utility code — they're where the
      protocol itself lives. Anything that has to look identical between
      services goes here, so it can never drift.
    </p>
    <table>
      <thead>
        <tr><th>Package</th><th>Responsibility</th></tr>
      </thead>
      <tbody>
        <tr><td><code>@transportial/kernel</code></td><td>Result, branded types, EUID/LEI/VAT/KvK parsers, JWK &amp; thumbprint helpers.</td></tr>
        <tr><td><code>@transportial/contracts</code></td><td>Wire schemas for BVAD, BVOD, trustlist, member descriptor.</td></tr>
        <tr><td><code>@transportial/crypto</code></td><td>BDI JWS profile, RFC 7523 verifier, key generation, HSM/PKCS#11/step-ca.</td></tr>
        <tr><td><code>@transportial/crypto-ca</code></td><td>RFC 8555 ACME server + client, CSR parser, X.509 issuer, OCSP, CRL.</td></tr>
        <tr><td><code>@transportial/identity</code></td><td>Keycloak OIDC verifier, eHerkenning SAML broker, <code>AuthnPort</code>.</td></tr>
        <tr><td><code>@transportial/events</code></td><td>Typed events, Valkey Streams consumer, rate limiter, scheduler.</td></tr>
        <tr><td><code>@transportial/policy</code></td><td>PDP port + embedded Cedar-like engine + external adapters.</td></tr>
        <tr><td><code>@transportial/config</code></td><td>Env parsing, <code>*_FILE</code> secrets, SIGHUP hot-reload, migrations, RLS, YAML.</td></tr>
        <tr><td><code>@transportial/observability</code></td><td>Structured logs, metrics registry, trace context, OTLP exporter.</td></tr>
        <tr><td><code>@transportial/openapi</code></td><td>OpenAPI 3.1 document builder used by <code>scripts/generate-openapi.ts</code>.</td></tr>
      </tbody>
    </table>

    <h2>Three planes, one mental model</h2>
    <p>
      A useful way to keep all of this in your head: think of BDI as three
      horizontal bands. The interactive explorer draws them exactly this way.
    </p>
    <ul>
      <li><strong>Trust plane</strong> — the ASR and its satellites (IdP,
        registries, CA, peer ASR). This is where identities are established.</li>
      <li><strong>Orchestration plane</strong> — the ORS and its
        subscriptions. This is where chain contexts are set up.</li>
      <li><strong>Data plane</strong> — connector-to-connector traffic plus
        the outbound upstreams. This is where actual payloads flow.</li>
    </ul>
    <p>
      Tokens issued in the trust plane (BVAD) and the orchestration plane
      (BVOD) are what the data plane verifies. The runtime data plane stays
      ignorant of identity providers and registries — all it needs is the
      ASR's trustlist and the ORS's public keys.
    </p>
  </main>

  <footer class="site-footer">
    <span>EUPL 1.2 · Transportial &amp; contributors · <a href="https://github.com/transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
