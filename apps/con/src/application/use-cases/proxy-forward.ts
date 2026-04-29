// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';
import type { HttpClientPort } from '../ports.ts';
import type { VerifyIncomingUseCase } from './verify-incoming.ts';

export interface UpstreamRoute {
  readonly pathPrefix: string;
  readonly target: string;
  readonly requiredScopes?: ReadonlyArray<string>;
  readonly stripPrefix?: boolean;
}

export interface ProxyForwardConfig {
  readonly routes: ReadonlyArray<UpstreamRoute>;
  readonly defaultTarget?: string;
  readonly timeoutMs?: number;
  readonly stripBdiHeaders?: boolean;
  readonly forwardHeaders?: ReadonlyArray<string>;
}

export interface ProxyRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bvad: string | null;
  readonly bvod: string | null;
  readonly action: string;
  readonly resource: { type: string; id: string; tags?: Record<string, string> };
  readonly clientCertThumbprint?: string | undefined;
}

export interface ProxyResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type ProxyError =
  | { type: 'no-matching-upstream'; path: string }
  | { type: 'verify-failed'; reason: string }
  | { type: 'upstream-failure'; message: string }
  | { type: 'mtls-required' }
  | { type: 'mtls-mismatch' };

export interface HeaderedHttpClient extends HttpClientPort {
  request(
    method: string,
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProxyResponse>;
}

// ProxyForwardUseCase verifies the incoming request (BVAD + BVOD + PDP),
// resolves the upstream by path prefix, forwards the request over private
// HTTP after stripping BDI headers, and returns the upstream response. When
// mTLS is enabled the caller supplies the client cert thumbprint (derived by
// the TLS terminator) and we verify it appears in the BVAD's connector claim.
export class ProxyForwardUseCase {
  constructor(
    private readonly verify: VerifyIncomingUseCase,
    private readonly http: HeaderedHttpClient,
    private readonly config: ProxyForwardConfig,
  ) {}

  async execute(req: ProxyRequest): Promise<Result<ProxyResponse, ProxyError>> {
    const verified = await this.verify.execute({
      bvad: req.bvad,
      bvod: req.bvod,
      action: req.action,
      resource: req.resource,
    });
    if (!verified.ok) return err({ type: 'verify-failed', reason: verified.error.type });

    if (req.clientCertThumbprint !== undefined) {
      const boundThumb = verified.value.bvad['https://bdi.nl/claims/connector'].x5t_s256;
      if (boundThumb !== req.clientCertThumbprint) {
        return err({ type: 'mtls-mismatch' });
      }
    }

    const upstream = this.resolveUpstream(req.path);
    if (!upstream) return err({ type: 'no-matching-upstream', path: req.path });

    const url = this.buildUpstreamUrl(upstream, req.path);
    const forwardedHeaders = this.buildForwardedHeaders(req.headers, verified.value.bvad.sub);
    try {
      const resp = await this.withTimeout(
        this.http.request(req.method, url, req.body, forwardedHeaders),
        this.config.timeoutMs ?? 10_000,
      );
      return ok(resp);
    } catch (e) {
      return err({ type: 'upstream-failure', message: e instanceof Error ? e.message : 'unknown' });
    }
  }

  private resolveUpstream(path: string): UpstreamRoute | null {
    let best: UpstreamRoute | null = null;
    for (const r of this.config.routes) {
      if (path.startsWith(r.pathPrefix) && (!best || r.pathPrefix.length > best.pathPrefix.length)) {
        best = r;
      }
    }
    return best;
  }

  private buildUpstreamUrl(upstream: UpstreamRoute, path: string): string {
    const target = upstream.target.replace(/\/$/, '');
    if (upstream.stripPrefix) {
      const remaining = path.slice(upstream.pathPrefix.length);
      return `${target}${remaining.startsWith('/') ? '' : '/'}${remaining}`;
    }
    return `${target}${path}`;
  }

  private buildForwardedHeaders(
    incoming: Readonly<Record<string, string>>,
    subjectConnectorId: string,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    const stripDefault = new Set([
      'authorization',
      'x-bdi-context',
      'x-bdi-signature',
      'cookie',
    ]);
    const strip = this.config.stripBdiHeaders === false ? new Set<string>() : stripDefault;
    const allow = new Set(
      (this.config.forwardHeaders ?? ['content-type', 'accept', 'content-length', 'accept-encoding']).map(
        (s) => s.toLowerCase(),
      ),
    );
    for (const [k, v] of Object.entries(incoming)) {
      const lk = k.toLowerCase();
      if (strip.has(lk)) continue;
      if (allow.has(lk)) out[lk] = v;
    }
    out['x-bdi-verified-subject'] = subjectConnectorId;
    return out;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`upstream timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
