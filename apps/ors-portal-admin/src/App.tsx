// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { useState } from 'react';
import { OrsClient, type ChainContextSummary } from './api.ts';

interface AppProps {
  client: OrsClient;
  associationId: string;
  actorEuid: string;
}

export function App({ client, associationId, actorEuid }: AppProps): JSX.Element {
  const [context, setContext] = useState<ChainContextSummary | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const appendLog = (msg: string): void => setLog((current) => [...current, msg]);

  const createCtx = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const out = await client.createContext({
        association_id: associationId,
        orchestrator: actorEuid,
        kind: String(fd.get('kind') ?? 'shipment') as 'shipment',
      });
      appendLog(`Created chain context ${out.chain_context_id}`);
      const ctx = await client.getContext(out.chain_context_id);
      setContext(ctx);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addParty = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!context) return;
    const fd = new FormData(e.currentTarget);
    try {
      await client.addParty(context.id, {
        actor: actorEuid,
        member_euid: String(fd.get('member_euid')),
        roles: String(fd.get('roles') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      const refreshed = await client.getContext(context.id);
      setContext(refreshed);
      appendLog(`Added ${String(fd.get('member_euid'))}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const publishEvent = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!context) return;
    const fd = new FormData(e.currentTarget);
    try {
      const out = await client.publishEvent(context.id, {
        publisher: actorEuid,
        event_type: String(fd.get('event_type')),
        payload: { message: String(fd.get('payload')) },
      });
      appendLog(`Published; ${out.deliveries.length} subscribers`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="t-app">
      <header className="t-header">
        <small className="t-caption">BDI · Orkestratie Register</small>
        <h1>Admin portal</h1>
        <p className="t-muted">
          Association <strong>{associationId}</strong> · acting as <strong>{actorEuid}</strong>
        </p>
      </header>

      {error !== null && (
        <div role="alert" className="t-alert">
          {error}
        </div>
      )}

      <section className="t-section">
        <h2>Create chain context</h2>
        <form className="t-form" onSubmit={createCtx}>
          <label className="t-field">
            Kind
            <select name="kind" aria-label="kind">
              <option value="shipment">shipment</option>
              <option value="order">order</option>
              <option value="transport">transport</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <button type="submit" className="t-btn">Create</button>
        </form>
      </section>

      {context !== null && (
        <>
          <section className="t-section">
            <div className="t-row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Context</h2>
              <span className="t-pill" data-status={context.status}>{context.status}</span>
            </div>
            <p className="t-muted" style={{ marginTop: 0 }}>
              <strong>{context.id}</strong> — kind {context.kind}
            </p>

            <h3>Parties</h3>
            {context.parties.length === 0 ? (
              <p className="t-muted">No parties yet.</p>
            ) : (
              <ul className="t-stack" style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
                {context.parties.map((p) => (
                  <li key={p.member_euid} className="t-row" style={{ justifyContent: 'space-between' }}>
                    <strong>{p.member_euid}</strong>
                    <span className="t-muted">{p.roles.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}

            <form className="t-form" onSubmit={addParty}>
              <label className="t-field">
                Member EUID
                <input name="member_euid" placeholder="NL.NHR.22222222" aria-label="member_euid" />
              </label>
              <label className="t-field">
                Roles
                <input name="roles" placeholder="carrier, consignee" aria-label="roles" />
              </label>
              <button type="submit" className="t-btn">Add party</button>
            </form>
          </section>

          <section className="t-section">
            <h2>Publish event</h2>
            <form className="t-form" onSubmit={publishEvent}>
              <label className="t-field">
                Event type
                <input name="event_type" placeholder="eta_updated" aria-label="event_type" />
              </label>
              <label className="t-field">
                Payload
                <input name="payload" placeholder="payload string" aria-label="payload" />
              </label>
              <button type="submit" className="t-btn">Publish</button>
            </form>
          </section>
        </>
      )}

      <section className="t-section">
        <h2>Activity</h2>
        {log.length === 0 ? (
          <p className="t-muted">Nothing logged yet.</p>
        ) : (
          <ul className="t-log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
