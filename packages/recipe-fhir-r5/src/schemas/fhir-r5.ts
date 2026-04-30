// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Pinned snapshot of the FHIR R5 resource surface relevant to clinical
// referral pathways and patient-summary exchange between care providers.
// Sourced from https://hl7.org/fhir/R5/. This file is a small structural
// snapshot — enough for the bundled MinimalFhirR5Validator to perform a sane
// structural check. Production deployments that want full schema validation
// should plug in their own FhirR5Validator backed by the upstream
// StructureDefinitions (e.g. via a profile-aware validator).

export const FHIR_VERSION = '5.0.0' as const;

// FHIR's canonical discriminator for any resource is `resourceType`. It is
// required and identifies which StructureDefinition applies.
export const FHIR_DISCRIMINATOR = 'resourceType' as const;

// Resource types in scope for the referrals + patient-summary exchange use
// cases this recipe targets. Extend via a custom validator if you need to
// transport other FHIR resources through the connector.
export const FHIR_RESOURCE_TYPES = [
  'AllergyIntolerance',
  'Bundle',
  'CarePlan',
  'Composition',
  'Condition',
  'Coverage',
  'DocumentReference',
  'Encounter',
  'MedicationRequest',
  'Observation',
  'Organization',
  'Patient',
  'Practitioner',
  'PractitionerRole',
  'Procedure',
  'RelatedPerson',
  'ServiceRequest',
] as const;

export type FhirResourceType = (typeof FHIR_RESOURCE_TYPES)[number];

const RESOURCE_SET: ReadonlySet<string> = new Set(FHIR_RESOURCE_TYPES);

export function isKnownFhirResourceType(value: unknown): value is FhirResourceType {
  return typeof value === 'string' && RESOURCE_SET.has(value);
}

// Required fields per resource type, narrowed to the structural elements we
// can cheaply check at the connector boundary. FHIR R5 makes `id` optional
// on create (server-assigned) so we do not require it here; the inspector
// simply omits the id tag when missing.
//
// - Bundle (used for transactions, batches, document bundles, IPS): MUST
//   carry `type` per the Bundle StructureDefinition.
// - Composition (used as the IPS root): MUST carry `status`, `type`,
//   `subject`, `date`, and `author`.
// - ServiceRequest (used to model a clinical referral): MUST carry `status`,
//   `intent`, and `subject` per the ServiceRequest StructureDefinition.
// - Other resources here pass the structural check so long as the
//   discriminator is recognised; deeper invariants are deferred to a
//   profile-aware validator.
export const FHIR_REQUIRED_FIELDS: Readonly<
  Record<FhirResourceType, ReadonlyArray<string>>
> = {
  AllergyIntolerance: ['resourceType', 'patient'],
  Bundle: ['resourceType', 'type'],
  CarePlan: ['resourceType', 'status', 'intent', 'subject'],
  Composition: ['resourceType', 'status', 'type', 'subject', 'date', 'author'],
  Condition: ['resourceType', 'subject'],
  Coverage: ['resourceType', 'status', 'beneficiary'],
  DocumentReference: ['resourceType', 'status', 'content'],
  Encounter: ['resourceType', 'status'],
  MedicationRequest: ['resourceType', 'status', 'intent', 'subject'],
  Observation: ['resourceType', 'status', 'code'],
  Organization: ['resourceType'],
  Patient: ['resourceType'],
  Practitioner: ['resourceType'],
  PractitionerRole: ['resourceType'],
  Procedure: ['resourceType', 'status', 'subject'],
  RelatedPerson: ['resourceType', 'patient'],
  ServiceRequest: ['resourceType', 'status', 'intent', 'subject'],
};
