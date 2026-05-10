// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { useCallback, useEffect, useState } from 'react';
import { AsrClient } from './api.ts';

type MemberRecord = { id: string; euid: string; legal_name: string; status: string };

interface AppProps {
  client: AsrClient;
  associationId: string;
}

export function App({ client, associationId }: AppProps): JSX.Element {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'members' | 'trustlist' | 'jwks'>('members');
  const [trustlistJws, setTrustlistJws] = useState<string>('');
  const [jwks, setJwks] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const tl = await client.trustlist(associationId);
      setTrustlistJws(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    try {
      const j = await client.jwks();
      setJwks(JSON.stringify(j, null, 2));
    } catch {
      /* optional */
    }
  }, [client, associationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addLocalMember = async (euid: string, legal_name: string): Promise<void> => {
    setError(null);
    try {
      const { member_id } = await client.createMember({
        euid,
        association_id: associationId,
        legal_name,
        signing_representative: {
          subject_id: 'portal-admin',
          auth_source: 'manual',
          assurance: 'high',
          verified_at: new Date().toISOString(),
        },
      });
      setMembers((m) => [...m, { id: member_id, euid, legal_name, status: 'draft' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runVerifications = async (id: string): Promise<void> => {
    try {
      await client.runVerifications(id);
      setMembers((m) => m.map((r) => (r.id === id ? { ...r, status: 'verified' } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const approve = async (id: string, approver: string): Promise<void> => {
    try {
      const { state } = await client.approve(id, approver);
      setMembers((m) =>
        m.map((r) => (r.id === id ? { ...r, status: state === 'activated' ? 'activated' : r.status } : r)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="t-app">
      <header className="t-header">
        <small className="t-caption">BDI · Associatie Register</small>
        <h1>Admin portal</h1>
        <p className="t-muted">
          Association <strong>{associationId}</strong>
        </p>
      </header>

      <nav className="t-tabs" role="tablist">
        {(['members', 'trustlist', 'jwks'] as const).map((t) => (
          <button
            key={t}
            className="t-tab"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {error !== null && (
        <div role="alert" className="t-alert">
          {error}
        </div>
      )}

      {tab === 'members' && (
        <MembersView
          members={members}
          onAdd={addLocalMember}
          onRunVerifications={runVerifications}
          onApprove={approve}
        />
      )}
      {tab === 'trustlist' && <TrustlistView jws={trustlistJws} />}
      {tab === 'jwks' && <JwksView jwks={jwks} />}
    </main>
  );
}

interface MembersViewProps {
  members: MemberRecord[];
  onAdd: (euid: string, legal_name: string) => Promise<void>;
  onRunVerifications: (id: string) => Promise<void>;
  onApprove: (id: string, approver: string) => Promise<void>;
}

function MembersView({
  members,
  onAdd,
  onRunVerifications,
  onApprove,
}: MembersViewProps): JSX.Element {
  const [euid, setEuid] = useState('');
  const [name, setName] = useState('');
  const [approver, setApprover] = useState('alice');
  return (
    <>
      <section className="t-section">
        <h2>Create member</h2>
        <form
          className="t-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onAdd(euid, name);
            setEuid('');
            setName('');
          }}
        >
          <label className="t-field">
            EUID
            <input
              aria-label="euid"
              placeholder="NL.NHR.12345678"
              value={euid}
              onChange={(e) => setEuid(e.target.value)}
            />
          </label>
          <label className="t-field">
            Legal name
            <input
              aria-label="legal name"
              placeholder="Acme B.V."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="t-btn">Add</button>
        </form>
      </section>

      <section className="t-section">
        <div className="t-row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Members</h2>
          <label className="t-field" style={{ flex: '0 0 220px' }}>
            Approver
            <input
              aria-label="approver"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
            />
          </label>
        </div>
        <div className="t-table-wrap">
          <table>
            <thead>
              <tr>
                <th>EUID</th>
                <th>Legal name</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="t-muted" style={{ textAlign: 'center' }}>
                    No members yet — create one above.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.euid}</td>
                  <td>{m.legal_name}</td>
                  <td>
                    <span className="t-pill" data-status={m.status}>{m.status}</span>
                  </td>
                  <td>
                    <span className="t-actions">
                      <button className="t-btn t-btn-secondary" onClick={() => void onRunVerifications(m.id)}>
                        Verify
                      </button>
                      <button className="t-btn" onClick={() => void onApprove(m.id, approver)}>
                        Approve
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TrustlistView({ jws }: { jws: string }): JSX.Element {
  return (
    <section className="t-section">
      <h2>Trustlist JWS</h2>
      <pre>{jws || '—'}</pre>
    </section>
  );
}

function JwksView({ jwks }: { jwks: string }): JSX.Element {
  return (
    <section className="t-section">
      <h2>JWKS</h2>
      <pre>{jwks || '—'}</pre>
    </section>
  );
}
