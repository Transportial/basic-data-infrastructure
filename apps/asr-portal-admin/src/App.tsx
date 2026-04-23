// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

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
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <header>
        <h1>BDI Associatie Register — admin portal</h1>
        <p style={{ color: '#666' }}>
          Association <strong>{associationId}</strong>
        </p>
      </header>

      <nav style={{ margin: '1rem 0' }}>
        {(['members', 'trustlist', 'jwks'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={tab === t}
            style={{ marginRight: 8 }}
          >
            {t}
          </button>
        ))}
      </nav>

      {error !== null && (
        <div role="alert" style={{ background: '#fee', padding: '0.5rem', marginBottom: 16 }}>
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
    <section>
      <h2>Create member</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(euid, name);
          setEuid('');
          setName('');
        }}
      >
        <input
          aria-label="euid"
          placeholder="EUID (NL.NHR.12345678)"
          value={euid}
          onChange={(e) => setEuid(e.target.value)}
        />
        <input
          aria-label="legal name"
          placeholder="Legal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      <h2>Members</h2>
      <label>
        Approver:
        <input
          aria-label="approver"
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
        />
      </label>
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
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.euid}</td>
              <td>{m.legal_name}</td>
              <td>{m.status}</td>
              <td>
                <button onClick={() => void onRunVerifications(m.id)}>Verify</button>
                <button onClick={() => void onApprove(m.id, approver)}>Approve</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TrustlistView({ jws }: { jws: string }): JSX.Element {
  return (
    <section>
      <h2>Trustlist JWS</h2>
      <pre style={{ background: '#f6f6f6', padding: '1rem', overflow: 'auto' }}>{jws || '—'}</pre>
    </section>
  );
}

function JwksView({ jwks }: { jwks: string }): JSX.Element {
  return (
    <section>
      <h2>JWKS</h2>
      <pre style={{ background: '#f6f6f6', padding: '1rem', overflow: 'auto' }}>{jwks || '—'}</pre>
    </section>
  );
}
