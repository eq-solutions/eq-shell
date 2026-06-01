/**
 * Canonical licence kind enum for EQ Cards OCR and any other module
 * that needs to classify a trade licence, ticket, or certification.
 *
 * Add new kinds here; regenerating eq-schemas is not required — this file
 * is hand-authored (not produced by the JSON-schema generator).
 */

export const LICENCE_KINDS = [
  { value: 'driver_licence',         label: 'Driver Licence' },
  { value: 'white_card',             label: 'White Card (Construction Induction)' },
  { value: 'forklift_licence',       label: 'Forklift Licence' },
  { value: 'ewp_licence',            label: 'EWP Licence (Elevated Work Platform)' },
  { value: 'electrical_licence',     label: 'Electrical Licence' },
  { value: 'plumbing_licence',       label: 'Plumbing Licence' },
  { value: 'working_at_heights',     label: 'Working at Heights Certificate' },
  { value: 'first_aid',             label: 'First Aid Certificate' },
  { value: 'asbestos_awareness',     label: 'Asbestos Awareness Certificate' },
  { value: 'confined_space',         label: 'Confined Space Entry Certificate' },
  { value: 'other',                  label: 'Other' },
] as const

export type LicenceKind = typeof LICENCE_KINDS[number]['value']

export const LICENCE_KIND_LABELS: Record<LicenceKind, string> = Object.fromEntries(
  LICENCE_KINDS.map(k => [k.value, k.label])
) as Record<LicenceKind, string>
