// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { OrsClient } from './api.ts';

const orsUrl = (import.meta.env.VITE_ORS_URL as string | undefined) ?? 'http://localhost:8081';
const associationId = (import.meta.env.VITE_ASSOCIATION_ID as string | undefined) ?? 'ctn';
const actorEuid = (import.meta.env.VITE_ACTOR_EUID as string | undefined) ?? 'NL.NHR.11111111';
const client = new OrsClient(orsUrl);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App client={client} associationId={associationId} actorEuid={actorEuid} />
    </StrictMode>,
  );
}
