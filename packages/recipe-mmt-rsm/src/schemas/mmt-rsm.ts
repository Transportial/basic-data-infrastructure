// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Pinned snapshot of the UN/CEFACT MMT-RSM (Multimodal Transport Reference
// Semantic Model) entity surface, aligned with the UN/CEFACT Buy-Ship-Pay
// reference data model and the MMT subset published for customs and shipping
// information exchange. This file is a small structural snapshot — enough
// for the bundled MinimalMmtRsmValidator to perform a sane structural check.
// Production deployments that want full schema validation should plug in
// their own MmtRsmValidator backed by the upstream UN/CEFACT XSDs (e.g. via
// Ajv with a JSON projection of the BSP RDM).

export const MMT_RSM_VERSION = '1.0.0' as const;

// Discriminator used by every MMT-RSM root entity. The MMT-RSM is built on
// the UN/CEFACT BSP reference data model where each root semantic object is
// identified by its entity name; we surface that as `entityType` for
// consistency with the other connector recipes.
export const MMT_RSM_DISCRIMINATOR = 'entityType' as const;

// Canonical MMT-RSM root entities, drawn from the multimodal transport
// subset of the UN/CEFACT BSP RDM. Listed in alphabetical order for
// review-friendliness.
export const MMT_RSM_ENTITY_TYPES = [
  'consignment',
  'customsDeclaration',
  'event',
  'goodsItem',
  'location',
  'party',
  'tradeLineItem',
  'transportContract',
  'transportDocument',
  'transportEquipment',
  'transportMeans',
  'transportMovement',
] as const;

export type MmtRsmEntityType = (typeof MMT_RSM_ENTITY_TYPES)[number];

const ENTITY_SET: ReadonlySet<string> = new Set(MMT_RSM_ENTITY_TYPES);

export function isKnownMmtRsmEntityType(value: unknown): value is MmtRsmEntityType {
  return typeof value === 'string' && ENTITY_SET.has(value);
}

// Required fields per entity type. Every MMT-RSM root entity has `id` and
// `entityType`; some have additional structural requirements that are cheap
// to check without dragging in a full schema engine. The required set
// follows the BSP "core" attributes a customs/shipping party must provide
// to make the entity processable by a counterparty.
export const MMT_RSM_REQUIRED_FIELDS: Readonly<
  Record<MmtRsmEntityType, ReadonlyArray<string>>
> = {
  consignment: ['id', 'entityType', 'consignor', 'consignee'],
  customsDeclaration: ['id', 'entityType', 'declarationType', 'declarant'],
  event: ['id', 'entityType', 'occurrenceDateTime'],
  goodsItem: ['id', 'entityType', 'description'],
  location: ['id', 'entityType'],
  party: ['id', 'entityType', 'role'],
  tradeLineItem: ['id', 'entityType', 'lineItemNumber'],
  transportContract: ['id', 'entityType', 'contractType'],
  transportDocument: ['id', 'entityType', 'documentType'],
  transportEquipment: ['id', 'entityType'],
  transportMeans: ['id', 'entityType', 'modeCode'],
  transportMovement: ['id', 'entityType', 'departureLocation', 'arrivalLocation'],
};
