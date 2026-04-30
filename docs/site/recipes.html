<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Recipes — BDI Kerncomponenten</title>
  <meta name="description" content="Domain recipes plug into the BDI Connector to validate and transport real-world data shapes — OTM 5.8 for transport today, more on the way." />
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
      <a href="./">Overview</a>
      <a href="architecture.html">Architecture</a>
      <a href="recipes.html" aria-current="page">Recipes</a>
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
      <span class="eyebrow"><span class="dot"></span>Connector add-ons · Domain recipes</span>
      <h1>Recipes — <em>real data</em>,<br/>through the connector.</h1>
      <p class="lede">
        The BDI core stays domain-neutral on purpose: BVAD says <em>who</em>,
        BVOD says <em>which chain</em>, the Connector enforces the boundary.
        <strong>Recipes</strong> are the layer on top — small, optional add-ons
        that teach the connector about a specific data shape (a transport
        consignment, a customs declaration, a clinical referral) so it can
        validate it, tag it, and route it without your backend reinventing the
        protocol.
      </p>
      <div class="hero-cta">
        <a href="#otm" class="btn">See the OTM recipe</a>
        <a href="https://github.com/Transportial/basic-data-infrastructure/tree/main/packages/recipe-otm" class="btn ghost">Source on GitHub</a>
      </div>
    </div>
  </section>

  <section class="content">
    <h2><span class="sigil">§1</span>What is a recipe?</h2>
    <p>
      A recipe is a TypeScript package that plugs into the <code>@transportial/con</code>
      connector at composition time. It implements one small port —
      <code>PayloadInspectorPort</code> — and the connector wires it into the
      proxy-forward path, ahead of the policy decision point.
    </p>
    <p>Each recipe gets to do four useful things:</p>
    <ul>
      <li><strong>Match</strong> the requests it cares about (by content type, path prefix, or method) and ignore everything else.</li>
      <li><strong>Validate</strong> the body against a domain schema and reject malformed payloads with HTTP 422 before the upstream sees them.</li>
      <li><strong>Extract</strong> domain identifiers from the payload and surface them as resource tags, so policies can authorise on real attributes (e.g. <em>only consignments tagged for this chain context</em>).</li>
      <li><strong>Stay optional</strong> — the connector core works fine without any recipes, and recipes ship as separate packages with their own release cadence.</li>
    </ul>

    <blockquote>
      <strong>Why not just put schema validation in the upstream backend?</strong>
      Because the same payload travels through two parties, and only the
      connector sees the BVAD + BVOD + content together. A bad payload that
      reaches the upstream has already been authorised. Recipes catch the
      mistake at the protocol boundary, where it's cheapest to reject and
      where the diagnostic ("OTM consignment is missing required field") is
      addressable to a counterparty rather than buried in an internal log.
    </blockquote>

    <h2 id="available"><span class="sigil">§2</span>Available recipes</h2>
    <div class="recipe-grid">
      <article class="recipe-card">
        <header>
          <span class="recipe-domain">Transport</span>
          <span class="recipe-version">v0.1.0</span>
        </header>
        <h3 id="otm">@transportial/recipe-otm</h3>
        <p class="recipe-tagline">OTM 5.8 — Open Transportation Model</p>
        <p>
          Validates and transports payloads against the
          <a href="https://otm-api-spec.redocly.app/api/5.8/otm" rel="noopener">OTM 5.8 specification</a>.
          The recipe matches <code>application/vnd.otm+json</code> on POST/PUT/PATCH (and <code>application/json</code>
          when you pin it to a path prefix), structurally validates the body against the pinned OTM 5.8 entity
          surface, and surfaces <code>otm.entityType</code>, <code>otm.id</code>, and <code>otm.version</code>
          as resource tags so your PDP can authorise on them.
        </p>
        <h4>Install</h4>
        <pre><code>bun add @transportial/recipe-otm
# or: npm install @transportial/recipe-otm</code></pre>
        <h4>Wire it into the connector</h4>
        <pre><code>import { composeCon } from '@transportial/con';
import { composeOtmRecipe } from '@transportial/recipe-otm';

const otm = composeOtmRecipe({ pathPrefixes: ['/otm'] });

const con = composeCon({
  asrIssuer: 'https://asr.example.org',
  orsIssuer: 'https://ors.example.org',
  associationId: 'eu.nl.bdi.acme',
  ownConnectorId: 'urn:bdi:connector:me',
  audience: 'urn:bdi:association:eu.nl.bdi.acme',
  inspectors: otm.inspectors,
});</code></pre>
        <h4>What you get on the wire</h4>
        <ul>
          <li>Malformed JSON or unknown <code>entityType</code> → <code>422 invalid-payload</code> with a structured <code>details</code> array.</li>
          <li>Valid OTM payload → request flows through to the upstream, with PDP resource tags <code>otm.entityType</code>, <code>otm.id</code>, <code>otm.version</code> available to your policy set.</li>
          <li>Non-OTM requests on the same connector → untouched.</li>
        </ul>
        <h4>Plugging in a richer validator</h4>
        <p>
          The bundled <code>MinimalOtmValidator</code> performs a fast structural
          check against the pinned 5.8 entity surface — useful out of the box,
          deliberately not a replacement for full schema validation. Production
          deployments that want every JSON-Schema constraint enforced can
          implement the <code>OtmValidator</code> interface against the upstream
          OpenAPI document (Ajv, valibot, anything you like) and pass it as
          <code>composeOtmRecipe({ validator: yourValidator })</code>.
        </p>
        <p class="recipe-links">
          <a href="https://github.com/Transportial/basic-data-infrastructure/tree/main/packages/recipe-otm">Source</a>
          ·
          <a href="https://www.npmjs.com/package/@transportial/recipe-otm">npm</a>
          ·
          <a href="https://otm-api-spec.redocly.app/api/5.8/otm" rel="noopener">OTM 5.8 spec</a>
        </p>
      </article>
    </div>

    <h2><span class="sigil">§3</span>Building your own recipe</h2>
    <p>
      A recipe is just a package that exposes a factory which returns one or
      more <code>PayloadInspectorPort</code> implementations. The interface is
      intentionally small — three members, all synchronous-or-async — so you
      can ship a recipe in an afternoon and iterate on the validation surface
      independently of the connector itself.
    </p>
    <pre><code>import type { PayloadInspectorPort } from '@transportial/con';

class FhirBundleInspector implements PayloadInspectorPort {
  readonly name = 'fhir';

  matches(req) {
    return req.method === 'POST'
      &amp;&amp; req.contentType.startsWith('application/fhir+json');
  }

  async inspect(req) {
    const parsed = JSON.parse(req.body);
    if (parsed.resourceType !== 'Bundle') {
      return { ok: false, reason: 'fhir-not-bundle' };
    }
    return {
      ok: true,
      resourceTags: { 'fhir.resourceType': parsed.resourceType, 'fhir.id': parsed.id ?? '' },
    };
  }
}</code></pre>
    <p>
      That's the whole hook. Hand a list of these to <code>composeCon</code>
      via the <code>inspectors</code> field and the connector will run them
      ahead of the PDP, short-circuit on failure, and merge any tags they
      produce into the PDP resource. The same seam is where future recipe
      artefacts (default policies, OTM-aware metrics, webhook validators) will
      land — without changing the connector contract.
    </p>

    <h2><span class="sigil">§4</span>Roadmap</h2>
    <p>
      Recipes are deliberately a thin layer — the value comes from breadth.
      The packages we expect to ship next, ordered by demand we've heard:
    </p>
    <ul>
      <li><strong>eFTI</strong> — EU electronic Freight Transport Information for cross-border road transport.</li>
      <li><strong>FHIR R5</strong> — clinical referral pathways and patient-summary exchange between care providers.</li>
      <li><strong>UN/CEFACT MMT-RSM</strong> — multimodal transport reference semantic model, for customs and shipping.</li>
      <li><strong>ISO 20022 pacs.008</strong> — financial settlement messages along a trade-finance chain.</li>
    </ul>
    <p>
      If you're building one of these and want to coordinate, open an issue on
      <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a> —
      we're keeping the recipe surface stable so external packages can ship
      without depending on private internals.
    </p>
  </section>

  <footer class="site-footer">
    <span>PolyForm Shield 1.0.0 · Transportial &amp; contributors · <a href="https://github.com/Transportial/basic-data-infrastructure">GitHub</a></span>
  </footer>
</body>
</html>
