// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Pinned snapshot of the OTM 5.8 entity surface. Sourced from the OTM API
// specification at https://otm-api-spec.redocly.app/api/5.8/otm. This file is
// intentionally a small structural snapshot — enough for the bundled
// MinimalOtmValidator to perform a sane structural check. Production
// deployments that want full schema validation should plug in their own
// OtmValidator backed by the upstream OpenAPI document (e.g. via Ajv).

export const OTM_VERSION = '5.8' as const;

// Discriminator value used by every OTM root entity. The OTM spec calls this
// "entityType"; it is required and identifies which entity shape applies.
export const OTM_DISCRIMINATOR = 'entityType' as const;

// Canonical OTM 5.8 root entity names (camelCase, matching the spec). Listed
// in alphabetical order for review-friendliness.
export const OTM_ENTITY_TYPES = [
  'actionEvent',
  'actor',
  'consignment',
  'document',
  'employee',
  'goods',
  'location',
  'organisation',
  'route',
  'sensor',
  'subcontract',
  'transportEquipment',
  'transportOrder',
  'trip',
  'vehicle',
  'vessel',
  'voyage',
] as const;

export type OtmEntityType = (typeof OTM_ENTITY_TYPES)[number];

const ENTITY_SET: ReadonlySet<string> = new Set(OTM_ENTITY_TYPES);

export function isKnownOtmEntityType(value: unknown): value is OtmEntityType {
  return typeof value === 'string' && ENTITY_SET.has(value);
}

// Required fields per entity type. Every OTM root entity has `id` and
// `entityType`; some have additional structural requirements that are cheap to
// check without dragging in a full JSON Schema engine.
export const OTM_REQUIRED_FIELDS: Readonly<Record<OtmEntityType, ReadonlyArray<string>>> = {
  actionEvent: ['id', 'entityType', 'lifecycle'],
  actor: ['id', 'entityType'],
  consignment: ['id', 'entityType'],
  document: ['id', 'entityType'],
  employee: ['id', 'entityType'],
  goods: ['id', 'entityType'],
  location: ['id', 'entityType'],
  organisation: ['id', 'entityType'],
  route: ['id', 'entityType'],
  sensor: ['id', 'entityType'],
  subcontract: ['id', 'entityType'],
  transportEquipment: ['id', 'entityType'],
  transportOrder: ['id', 'entityType'],
  trip: ['id', 'entityType'],
  vehicle: ['id', 'entityType'],
  vessel: ['id', 'entityType'],
  voyage: ['id', 'entityType'],
};
