// Single source of truth for which lifecycle actions each canonical entity
// allows. Policy lives here (domain layer), not in the per-surface action bars —
// every surface (CustomersHubPage, EntityBrowserPage, StaffPage, plant &
// equipment) reads this so the same entity offers the same actions everywhere.
//
// Rule of thumb (FK / reference safety):
//   - archive: always available (reversible, soft delete).
//   - delete: only leaf-ish entities with no cascade risk; the backend still
//     blocks a delete that has dependent records (FK 23503 -> 409).
//   - merge: dedup affordance for entities that accumulate duplicates.
//
// Customers and staff are archive-only on purpose: they anchor sites, contacts,
// quotes, jobs, timesheets and licences, so a hard delete is never offered
// (merge handles customer dedup). Unlisted entities default to archive-only —
// secure by default; opt a new entity into delete explicitly.

export interface EntityCapabilities {
  archive: boolean;
  delete: boolean;
  merge: boolean;
}

export const ENTITY_CAPABILITIES: Record<string, EntityCapabilities> = {
  customer: { archive: true, delete: false, merge: true },
  staff:    { archive: true, delete: false, merge: false },
  site:     { archive: true, delete: true,  merge: false },
  contact:  { archive: true, delete: true,  merge: true },
  asset:    { archive: true, delete: true,  merge: false },
};

const DEFAULT_CAPS: EntityCapabilities = { archive: true, delete: false, merge: false };

export function entityCapabilities(entity: string): EntityCapabilities {
  return ENTITY_CAPABILITIES[entity] ?? DEFAULT_CAPS;
}

export function entityAllows(entity: string, action: keyof EntityCapabilities): boolean {
  return entityCapabilities(entity)[action];
}
