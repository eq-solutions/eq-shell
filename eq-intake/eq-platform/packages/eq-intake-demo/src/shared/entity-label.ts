/**
 * entityLabel — the one plain-English plural for a canonical entity, shared by
 * every surface that shows commit results (the compact summary, the per-row
 * drill-downs, the mapping preview).
 *
 * Kept in its own module so the drill-down / mapping components below can be
 * lifted out of CanonicalCommitSection without dragging a copy of this along.
 */

import type { CanonicalEntity } from "../canonical/commit-canonical.js";

export function entityLabel(entity: CanonicalEntity | string): string {
  switch (entity) {
    case "customer":
      return "Customers";
    case "site":
      return "Sites";
    case "contact":
      return "Contacts";
    case "staff":
      return "Staff";
    case "licence":
      return "Licences";
    default:
      return String(entity);
  }
}
