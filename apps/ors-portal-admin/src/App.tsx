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
    <main style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '2rem auto' }}>
      <h1>BDI Orkestratie Register — admin ({associationId})</h1>
      {error !== null && (
        <div role="alert" style={{ background: '#fee', padding: '0.5rem', marginBottom: 16 }}>
          {error}
        </div>
      )}

      <section>
        <h2>Create chain context</h2>
        <form onSubmit={createCtx}>
          <label>
            Kind:{' '}
            <select name="kind" aria-label="kind">
              <option value="shipment">shipment</option>
              <option value="order">order</option>
              <option value="transport">transport</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <button type="submit">Create</button>
        </form>
      </section>

      {context !== null && (
        <>
          <section>
            <h2>Context {context.id}</h2>
            <p>Status: {context.status}</p>
            <p>Kind: {context.kind}</p>
            <h3>Parties</h3>
            <ul>
              {context.parties.map((p) => (
                <li key={p.member_euid}>
                  {p.member_euid} — {p.roles.join(', ')}
                </li>
              ))}
            </ul>
            <form onSubmit={addParty}>
              <input name="member_euid" placeholder="NL.NHR.22222222" aria-label="member_euid" />
              <input name="roles" placeholder="carrier,consignee" aria-label="roles" />
              <button type="submit">Add party</button>
            </form>
          </section>

          <section>
            <h2>Publish event</h2>
            <form onSubmit={publishEvent}>
              <input name="event_type" placeholder="eta_updated" aria-label="event_type" />
              <input name="payload" placeholder="payload string" aria-label="payload" />
              <button type="submit">Publish</button>
            </form>
          </section>
        </>
      )}

      <section>
        <h2>Activity</h2>
        <ul>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
