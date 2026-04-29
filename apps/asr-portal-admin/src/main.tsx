// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AsrClient } from './api.ts';

const asrUrl = (import.meta.env.VITE_ASR_URL as string | undefined) ?? 'http://localhost:8080';
const associationId = (import.meta.env.VITE_ASSOCIATION_ID as string | undefined) ?? 'ctn';
const client = new AsrClient(asrUrl);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App client={client} associationId={associationId} />
    </StrictMode>,
  );
}
