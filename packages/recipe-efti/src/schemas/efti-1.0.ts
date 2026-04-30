// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Pinned snapshot of the eFTI 1.0 common dataset entity surface, aligned with
// Regulation (EU) 2020/1056 and Implementing Regulation (EU) 2024/2667 on the
// electronic Freight Transport Information common data set for cross-border
// road transport. This file is intentionally a small structural snapshot —
// enough for the bundled MinimalEftiValidator to perform a sane structural
// check. Production deployments that want full schema validation should plug
// in their own EftiValidator backed by the upstream XSD/JSON Schema (e.g. via
// Ajv).

export const EFTI_VERSION = '1.0.0' as const;

// Discriminator value used by every eFTI root entity. The eFTI dataset uses
// an `eftiType` discriminator to distinguish information sub-objects
// transported as part of the cross-border road consignment record.
export const EFTI_DISCRIMINATOR = 'eftiType' as const;

// Canonical eFTI 1.0 root entity names. These cover the data subset required
// by the eFTI Regulation for road transport: the consignment, the goods
// carried, the equipment used, the parties involved, route stops, transport
// events, and accompanying documents.
export const EFTI_ENTITY_TYPES = [
  'consignment',
  'dangerousGoods',
  'document',
  'goodsItem',
  'location',
  'party',
  'route',
  'transportEquipment',
  'transportEvent',
  'transportMeans',
] as const;

export type EftiEntityType = (typeof EFTI_ENTITY_TYPES)[number];

const ENTITY_SET: ReadonlySet<string> = new Set(EFTI_ENTITY_TYPES);

export function isKnownEftiEntityType(value: unknown): value is EftiEntityType {
  return typeof value === 'string' && ENTITY_SET.has(value);
}

// Required fields per entity type. Every eFTI root entity has `id` and
// `eftiType`; some have additional structural requirements that are cheap to
// check without dragging in a full JSON Schema engine. The required set
// follows the cross-border road CMR-aligned subset: a consignment must name
// its sender and consignee, a transport event must carry an occurrence time,
// dangerous goods must carry their UN number.
export const EFTI_REQUIRED_FIELDS: Readonly<Record<EftiEntityType, ReadonlyArray<string>>> = {
  consignment: ['id', 'eftiType', 'senderParty', 'consigneeParty'],
  dangerousGoods: ['id', 'eftiType', 'unNumber'],
  document: ['id', 'eftiType', 'documentType'],
  goodsItem: ['id', 'eftiType'],
  location: ['id', 'eftiType'],
  party: ['id', 'eftiType', 'partyRole'],
  route: ['id', 'eftiType'],
  transportEquipment: ['id', 'eftiType'],
  transportEvent: ['id', 'eftiType', 'occurrenceDateTime'],
  transportMeans: ['id', 'eftiType', 'modeCode'],
};
