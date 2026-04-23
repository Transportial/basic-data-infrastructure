// SPDX-License-Identifier: EUPL-1.2
// Interactive BDI explorer — vanilla JS, zero dependencies.

const NODES = {
  'member-a': {
    title: 'Member A (organisation)',
    body: `An organisation that onboards into an association. Identified by its
    EUID (e.g. <code>eu.nl:kvk:12345678</code>), backed by a KvK/KBO/LEI
    record and authenticated via eHerkenning/eIDAS. Registers one or more
    connectors under this membership.`,
  },
  'member-b': {
    title: 'Member B (peer organisation)',
    body: `Another member of the same association — or a member of a federated
    peer association. Connector B is bound to its EUID and signs its own
    client assertions.`,
  },
  keycloak: {
    title: 'Keycloak / IdP',
    body: `Authenticates humans against eHerkenning (SAML) or eIDAS. ASR
    accepts OIDC access tokens from Keycloak via <code>@bdi/identity</code>'s
    <code>OidcAccessTokenVerifier</code>, which caches JWKS and validates
    <code>iss/aud/exp</code> plus maps <code>acr</code> → assurance level.`,
  },
  registries: {
    title: 'External registries',
    body: `Authoritative sources consulted during member verification:
    <ul>
      <li><strong>KvK</strong> &amp; <strong>KBO</strong> — Dutch / Belgian company register</li>
      <li><strong>GLEIF</strong> — Legal Entity Identifier lookup</li>
      <li><strong>VIES</strong> — EU VAT number validation</li>
    </ul>`,
  },
  ca: {
    title: 'ACME CA (step-ca / HSM)',
    body: `Issues X.509 certificates bound to a connector's public key, via
    RFC 8555 (ACME v2). The ASR speaks the client side; operators plug in
    <code>Pkcs11Backend</code> or <code>StepCaBackend</code> for private-key
    custody. Short-lived leaf certs automatically renew via the scheduler.`,
  },
  'peer-asr': {
    title: 'Peer ASR (federation partner)',
    body: `A remote ASR belonging to another association. RFC 8693 token
    exchange lets a peer's BVAD be re-issued locally after signature and
    <code>peer_association</code> checks. Per-peer claim transformation
    rules (YAML) reshape the outgoing token.`,
  },
  asr: {
    title: 'ASR — Associatie Register',
    body: `<p>Governs <em>who</em> can participate. Aggregates:</p>
    <ul>
      <li><code>Member</code> — onboarding, verification, 4-eyes approval</li>
      <li><code>Connector</code> — registration, key binding, cert issuance</li>
    </ul>
    <p>Issues the <strong>BVAD</strong> (attribute token) that proves a
    connector belongs to an active member of the association, at a specific
    assurance level. Also signs the federation trustlist.</p>`,
  },
  ors: {
    title: 'ORS — Orkestratie Register',
    body: `<p>Governs <em>who does what in a logistics chain</em>. Aggregate:</p>
    <ul>
      <li><code>ChainContext</code> — parties, delegations, natural-person
        pseudonyms, identifiers (BOL, AWB, …)</li>
    </ul>
    <p>Issues the <strong>BVOD</strong> (authorisation token) scoped to a
    context. Pushes events to subscribed connectors via Valkey Streams.
    Natural-person PII never leaves the member — ORS stores only SHA-256
    pseudonyms.</p>`,
  },
  'con-a': {
    title: 'Connector A (consumer)',
    body: `<p>Makes calls into other connectors on behalf of Member A.</p>
    <ol>
      <li>Signs a <strong>client assertion</strong> (RFC 7523) to exchange
        for a BVAD at the ASR token endpoint.</li>
      <li>Attaches the BVAD + optional BVOD to the outbound request.</li>
      <li>On success, posts events/webhooks to subscribed peers.</li>
    </ol>`,
  },
  'con-b': {
    title: 'Connector B (provider)',
    body: `<p>Receives calls. Verification pipeline:</p>
    <ol>
      <li>BVAD signature vs. ASR trustlist</li>
      <li>BVAD claim timing, issuer, audience, status</li>
      <li>BVOD signature vs. ORS trust store</li>
      <li>BVOD context, subject connector, scope</li>
      <li>Local PDP decision (Cedar / OPA / Keycloak-AuthZ)</li>
    </ol>`,
  },
};

const FLOWS = {
  onboarding: {
    title: 'Member onboarding',
    body: `<p>Member A applies for membership; ASR verifies through external
    registries and a 4-eyes approval gate.</p>`,
    steps: [
      { edges: ['member-asr'],     payload: 'apply',      comment: 'POST /admin/members { euid, legal_name, signing_rep }' },
      { edges: ['asr-reg'],         payload: 'KvK lookup', comment: 'ASR queries KvK/KBO/GLEIF/VIES' },
      { edges: ['asr-reg'],         payload: 'verified',   comment: 'Registries respond; verifications recorded', reverse: true },
      { edges: ['asr-keycloak'],    payload: 'eHerk OIDC', comment: 'Signing representative authenticated via Keycloak' },
      { edges: ['member-asr'],      payload: 'activated',  comment: '4-eyes approval completes → member.activated event', reverse: true },
    ],
    highlight: ['member-a', 'asr', 'keycloak', 'registries'],
  },
  connector: {
    title: 'Connector registration (ACME)',
    body: `<p>A newly approved member registers a connector key and obtains
    an X.509 leaf certificate from the ACME CA.</p>`,
    steps: [
      { edges: ['member-asr'], payload: 'CSR + jwk', comment: 'POST /admin/connectors with kid, public JWK, and CSR' },
      { edges: ['asr-ca'],     payload: 'newOrder',   comment: 'ASR opens an ACME order against the CA' },
      { edges: ['asr-ca'],     payload: 'challenge',  comment: 'CA returns DNS-01/HTTP-01 challenges', reverse: true },
      { edges: ['asr-ca'],     payload: 'finalize',   comment: 'ASR submits finalisation with the CSR' },
      { edges: ['asr-ca'],     payload: 'cert',       comment: 'CA returns the signed leaf certificate', reverse: true },
      { edges: ['member-asr'], payload: 'bound',      comment: 'Connector bound: kid + cert thumbprint recorded', reverse: true },
    ],
    highlight: ['member-a', 'asr', 'ca'],
  },
  bvad: {
    title: 'Issue a BVAD',
    body: `<p>Connector A presents an RFC 7523 client assertion and exchanges
    it for a short-lived Bewijs van Associatie-Deelname.</p>`,
    steps: [
      { edges: ['memberA-conA'], payload: 'trigger',   comment: 'Application wants to call a peer' },
      { edges: ['asr-conA'],     payload: 'client_assertion', comment: 'CON A → ASR /oauth2/token (client_credentials)', reverse: true },
      { edges: ['asr-conA'],     payload: 'BVAD JWS',  comment: 'ASR validates assertion, issues signed BVAD' },
    ],
    highlight: ['con-a', 'asr'],
  },
  context: {
    title: 'Create a chain context',
    body: `<p>The orchestrator creates a chain context in ORS, identifying
    parties and delegations. Natural persons appear only as pseudonyms.</p>`,
    steps: [
      { edges: ['asr-ors'],      payload: 'BVAD',       comment: 'Orchestrator auth validated via BVAD' },
      { edges: ['member-asr'],   payload: 'create ctx', comment: 'POST /chain-contexts { identifiers, parties, delegations }' },
      { edges: ['ors-conA'],     payload: 'subscribe',  comment: 'Connectors subscribed to event types' },
      { edges: ['ors-conB'],     payload: 'subscribe',  comment: 'Both sides receive event subscriptions' },
    ],
    highlight: ['asr', 'ors', 'con-a', 'con-b'],
  },
  bvod: {
    title: 'Issue a BVOD',
    body: `<p>ORS mints a BVOD scoped to (context, subject connector, peer)
    proving a specific action is authorised within the chain context.</p>`,
    steps: [
      { edges: ['ors-conA'],  payload: 'request',   comment: 'CON A → ORS /bvod { chain_context_id, scope }', reverse: true },
      { edges: ['ors-conA'],  payload: 'BVOD JWS',  comment: 'ORS verifies BVAD + chain-context membership, signs BVOD' },
    ],
    highlight: ['ors', 'con-a'],
  },
  delivery: {
    title: 'Deliver a webhook',
    body: `<p>CON A calls CON B with BVAD + BVOD; CON B validates both, runs
    the PDP, and returns the response. CON A retries with exponential
    backoff if the target is temporarily unreachable.</p>`,
    steps: [
      { edges: ['conA-conB'], payload: 'BVAD+BVOD', comment: 'POST with Authorization: Bearer <BVAD>; X-BDI-BVOD: <BVOD>' },
      { edges: ['ors-conB'],  payload: 'verify',    comment: 'CON B verifies BVOD against ORS trust store', reverse: true },
      { edges: ['asr-conB'],  payload: 'trustlist', comment: 'CON B verifies BVAD against cached ASR trustlist', reverse: true },
      { edges: ['conA-conB'], payload: '200 OK',    comment: 'PDP allows; response returned', reverse: true },
      { edges: ['memberB-conB'], payload: 'deliver', comment: 'CON B forwards to Member B upstream' },
    ],
    highlight: ['con-a', 'con-b', 'asr', 'ors'],
  },
  federation: {
    title: 'Cross-association exchange (RFC 8693)',
    body: `<p>A peer association mints a BVAD for its own member; our ASR
    verifies the peer's signature, re-issues a local BVAD, and optionally
    applies per-peer claim-transformation rules.</p>`,
    steps: [
      { edges: ['asr-peer'],   payload: 'peer BVAD', comment: 'Peer ASR issues BVAD under its own trustlist', reverse: true },
      { edges: ['asr-peer'],   payload: 'exchange',  comment: 'Local ASR /oauth2/token?grant=token-exchange' },
      { edges: ['asr-peer'],   payload: 'verify',    comment: 'Signature verified via PostgresFederationRegistry JWK', reverse: true },
      { edges: ['memberA-conA'], payload: 'local BVAD', comment: 'Local BVAD returned to requesting connector' },
    ],
    highlight: ['asr', 'peer-asr'],
  },
};

const svg = document.getElementById('bdi-canvas');
const panel = document.getElementById('detail-panel');
const tokenLayer = document.getElementById('token-layer');
const flowButtons = document.querySelectorAll('.flow-btn');

function renderNodeDetail(id) {
  const data = NODES[id];
  if (!data) return;
  panel.innerHTML = `<h3>${data.title}</h3>${data.body}`;
  svg.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'));
  const node = svg.querySelector(`[data-node="${id}"]`);
  if (node) node.classList.add('active');
}

function clearHighlights() {
  svg.querySelectorAll('.edge.active').forEach((e) => e.classList.remove('active'));
  svg.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'));
  tokenLayer.innerHTML = '';
}

function highlightNodes(ids) {
  ids.forEach((id) => {
    const n = svg.querySelector(`[data-node="${id}"]`);
    if (n) n.classList.add('active');
  });
}

function highlightEdge(id, on) {
  const e = svg.querySelector(`[data-edge="${id}"]`);
  if (e) e.classList.toggle('active', on);
}

async function animateToken(edgeId, payload, reverse, durationMs) {
  const edge = svg.querySelector(`[data-edge="${edgeId}"]`);
  if (!edge) return;
  const length = edge.getTotalLength();
  const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  bubble.setAttribute('class', 'token-bubble');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', '26');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.textContent = payload;
  bubble.append(circle, text);
  tokenLayer.appendChild(bubble);

  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = reverse ? (1 - i / steps) : (i / steps);
    const point = edge.getPointAtLength(length * t);
    bubble.setAttribute('transform', `translate(${point.x}, ${point.y})`);
    await sleep(durationMs / steps);
  }
  await sleep(100);
  bubble.remove();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFlow(flowId) {
  const flow = FLOWS[flowId];
  if (!flow) return;

  clearHighlights();
  panel.innerHTML = `<h3>${flow.title}</h3>${flow.body}<div id="flow-step" class="muted" style="margin-top:8px; min-height:40px;"></div>`;
  const stepEl = document.getElementById('flow-step');

  highlightNodes(flow.highlight);

  // Reset active button states
  flowButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.flow === flowId));

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    stepEl.textContent = `Step ${i + 1}/${flow.steps.length}: ${step.comment}`;
    for (const e of step.edges) highlightEdge(e, true);
    await Promise.all(step.edges.map((e) => animateToken(e, step.payload, !!step.reverse, 900)));
    for (const e of step.edges) highlightEdge(e, false);
    await sleep(120);
  }
  stepEl.textContent = `✔ flow complete — pick another flow or click a component`;
}

// Wire up
svg.querySelectorAll('.node').forEach((n) => {
  n.addEventListener('click', () => renderNodeDetail(n.dataset.node));
});
flowButtons.forEach((btn) => {
  btn.addEventListener('click', () => runFlow(btn.dataset.flow));
});

// Start on the ASR so the page isn't blank
renderNodeDetail('asr');
