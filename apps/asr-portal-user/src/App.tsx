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
        const result = await client.startOnboarding({
          euid: String(fd.get('euid')),
          legal_name: String(fd.get('legal_name')),
          vat_number: fd.get('vat_number') ? String(fd.get('vat_number')) : undefined,
          lei: fd.get('lei') ? String(fd.get('lei')) : undefined,
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
    <main style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '2rem auto' }}>
      <h1>BDI onboarding — association {associationId}</h1>
      {error !== null && (
        <div role="alert" style={{ background: '#fee', padding: '0.5rem', marginBottom: 16 }}>
          {error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <label>
          EUID (e.g. NL.NHR.12345678){' '}
          <input name="euid" required aria-label="euid" />
        </label>
        <br />
        <label>
          Legal name <input name="legal_name" required aria-label="legal name" />
        </label>
        <br />
        <label>
          VAT number (optional) <input name="vat_number" aria-label="vat" />
        </label>
        <br />
        <label>
          LEI (optional) <input name="lei" aria-label="lei" />
        </label>
        <br />
        <label>
          Signing representative <input name="representative" aria-label="representative" />
        </label>
        <br />
        <button type="submit">Start onboarding</button>
      </form>

      {memberId !== null && (
        <section>
          <p>Draft member created — id {memberId}</p>
          <button onClick={() => void onVerify()}>Run verifications</button>
        </section>
      )}

      <section>
        <h2>Public descriptor lookup</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void onFetchDescriptor(String(fd.get('lookup')));
          }}
        >
          <input name="lookup" placeholder="NL.NHR.12345678" aria-label="lookup" />
          <button type="submit">Look up</button>
        </form>
        {descriptor !== null && (
          <pre style={{ background: '#f6f6f6', padding: '1rem', overflow: 'auto' }}>{descriptor}</pre>
        )}
      </section>
    </main>
  );
}
