// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { useCallback, useState } from 'react';
import { UserAsrClient } from './api.ts';

interface AppProps {
  client: UserAsrClient;
  associationId: string;
}

export function App({ client, associationId }: AppProps): JSX.Element {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [descriptor, setDescriptor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      setError(null);
      try {
        const vat = fd.get('vat_number');
        const lei = fd.get('lei');
        const result = await client.startOnboarding({
          euid: String(fd.get('euid')),
          legal_name: String(fd.get('legal_name')),
          ...(vat ? { vat_number: String(vat) } : {}),
          ...(lei ? { lei: String(lei) } : {}),
          signing_representative: {
            subject_id: String(fd.get('representative') ?? 'self'),
            auth_source: 'manual',
            assurance: 'high',
            verified_at: new Date().toISOString(),
          },
        });
        setMemberId(result.memberId);
        form.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  const onVerify = useCallback(async () => {
    if (!memberId) return;
    try {
      await client.triggerVerifications(memberId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, memberId]);

  const onFetchDescriptor = useCallback(
    async (euid: string) => {
      try {
        setDescriptor(await client.fetchMemberDescriptor(euid));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  return (
    <main className="t-app">
      <header className="t-header">
        <small className="t-caption">BDI · Onboarding</small>
        <h1>Join association {associationId}</h1>
        <p className="t-muted">
          Register your organisation, run identity verifications, and fetch the public descriptor of any member.
        </p>
      </header>

      {error !== null && (
        <div role="alert" className="t-alert">
          {error}
        </div>
      )}

      <section className="t-section">
        <h2>Onboard organisation</h2>
        <form className="t-form" onSubmit={onSubmit}>
          <label className="t-field">
            EUID
            <input name="euid" required aria-label="euid" placeholder="NL.NHR.12345678" />
          </label>
          <label className="t-field">
            Legal name
            <input name="legal_name" required aria-label="legal name" placeholder="Acme B.V." />
          </label>
          <label className="t-field">
            VAT number <span className="t-muted">(optional)</span>
            <input name="vat_number" aria-label="vat" placeholder="NL000000000B00" />
          </label>
          <label className="t-field">
            LEI <span className="t-muted">(optional)</span>
            <input name="lei" aria-label="lei" placeholder="529900T8BM49AURSDO55" />
          </label>
          <label className="t-field">
            Signing representative
            <input name="representative" aria-label="representative" placeholder="alice@acme.eu" />
          </label>
          <button type="submit" className="t-btn">Start onboarding</button>
        </form>

        {memberId !== null && (
          <div className="t-row" style={{ marginTop: '1.5rem' }}>
            <span className="t-pill" data-status="draft">Draft</span>
            <span className="t-muted">Member id <strong>{memberId}</strong></span>
            <button className="t-btn t-btn-secondary" onClick={() => void onVerify()}>
              Run verifications
            </button>
          </div>
        )}
      </section>

      <section className="t-section">
        <h2>Public descriptor lookup</h2>
        <form
          className="t-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void onFetchDescriptor(String(fd.get('lookup')));
          }}
        >
          <label className="t-field">
            EUID
            <input name="lookup" placeholder="NL.NHR.12345678" aria-label="lookup" />
          </label>
          <button type="submit" className="t-btn">Look up</button>
        </form>
        {descriptor !== null && (
          <pre style={{ marginTop: '1.5rem' }}>{descriptor}</pre>
        )}
      </section>
    </main>
  );
}
