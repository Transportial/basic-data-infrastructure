// SPDX-License-Identifier: Apache-2.0 OR LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// PayloadInspector is the extension point for "recipes": optional, payload-aware
// add-ons (OTM, eFTI, FHIR, ...) that validate and tag domain data before the
// connector authorises the call. Each inspector decides whether it applies to a
// given request via `matches`; if it does, `inspect` either accepts the payload
// (optionally returning resource tags that get merged into the PDP resource) or
// rejects it with a structured reason.
//
// These types live in @transportial/contracts so that recipe packages can
// implement them without taking a dependency on the @transportial/con app
// (which would create a packages -> apps build edge that breaks DTS bundling).

export interface PayloadInspectionRequest {
  readonly method: string;
  readonly path: string;
  readonly contentType: string;
  readonly body: string;
}

export type PayloadInspectionResult =
  | { readonly ok: true; readonly resourceTags?: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: string; readonly details?: ReadonlyArray<string> };

export interface PayloadInspectorPort {
  readonly name: string;
  matches(req: PayloadInspectionRequest): boolean;
  inspect(req: PayloadInspectionRequest): Promise<PayloadInspectionResult>;
}
