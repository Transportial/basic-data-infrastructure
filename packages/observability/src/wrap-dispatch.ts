// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { ObservabilityLayer } from './http-middleware.ts';

// A thin functional wrapper that binds a request dispatch function into an
// ObservabilityLayer.observe() call. Services don't need to know about
// AsyncLocalStorage: they call `wrapDispatch(layer, dispatch)` during router
// construction and every handled request goes through it.

export interface MinimalDispatchInput {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MinimalDispatchOutput {
  readonly status: number;
}

export function wrapDispatch<TIn extends MinimalDispatchInput, TOut extends MinimalDispatchOutput>(
  layer: ObservabilityLayer,
  dispatch: (req: TIn) => Promise<TOut>,
): (req: TIn) => Promise<TOut> {
  return async (req) => {
    const attrs: Record<string, string> = {
      'http.method': req.method,
      'http.route': req.path,
      method: req.method,
      route: req.path,
    };
    const traceparent = req.headers?.['traceparent'] ?? null;
    let captured: TOut | undefined;
    await layer.observe(`HTTP ${req.method} ${req.path}`, traceparent, attrs, async () => {
      const out = await dispatch(req);
      captured = out;
      return { status: out.status };
    });
    // observe() always runs its callback synchronously with respect to its
    // promise, so `captured` is set before we return.
    return captured as TOut;
  };
}
