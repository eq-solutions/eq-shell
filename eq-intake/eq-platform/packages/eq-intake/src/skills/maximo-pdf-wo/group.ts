/**
 * group.ts — collapse mapped rows into `MaintenanceCheckBundle`s.
 *
 * Group key: `${siteCode}|${planCode}|${frequency ?? ""}|${dueDate}`.
 *
 * Matches the rule used by the Delta xlsx importer in eq-solves-service
 * (`lib/import/delta-wo-parser.ts::groupKey`) so the two intake paths
 * collapse to the same maintenance_check rows.
 *
 * For the fixture in `equinix-maximo-pdf-wo-2026-05-19/`:
 *   - 6 ATS WOs at CA1, plan E1.8, quarterly, 2026-05-20 → 1 bundle
 *   - 1 CUFT WO at CA1, plan E1.33, annual, 2026-06-20    → 1 bundle
 */
import type { MappedRow } from "./to-canonical.js";
import type { MaintenanceCheckBundle, MaintenanceCheckInsert } from "./types.js";

/** Build group key from a check insert. */
export function groupKeyFor(check: MaintenanceCheckInsert): string {
  return [
    check.site_code,
    check.plan_code,
    check.frequency ?? "",
    check.due_date,
  ].join("|");
}

/**
 * Collapse mapped rows into bundles. Insertion-ordered: the first time we
 * see a group key drives bundle order. Within a bundle, check_assets stay
 * in WO-number order (sorted ascending) so re-parses produce identical
 * output regardless of source-file iteration order.
 */
export function groupMappedRows(rows: MappedRow[]): MaintenanceCheckBundle[] {
  // Sort by (group_key, work_order_number) so the parent_check's source +
  // descriptive fields are derived from the lowest-numbered WO in the group,
  // independent of source-file iteration order. Re-parsing the same fixtures
  // in any order then yields byte-identical bundles.
  const sortedRows = [...rows].sort((a, b) => {
    const ka = groupKeyFor(a.parent_check);
    const kb = groupKeyFor(b.parent_check);
    if (ka !== kb) return ka.localeCompare(kb);
    return a.check_asset.work_order_number.localeCompare(
      b.check_asset.work_order_number,
    );
  });

  const byKey = new Map<string, MaintenanceCheckBundle>();

  for (const row of sortedRows) {
    const key = groupKeyFor(row.parent_check);
    let bundle = byKey.get(key);
    if (!bundle) {
      // First row (lowest-WO in this group) defines the bundle's parent_check.
      // Clear maximo_wo_number from the parent — it's only meaningful when
      // the bundle has exactly one WO; re-derived below.
      bundle = {
        group_key: key,
        maintenance_check: { ...row.parent_check, maximo_wo_number: null },
        check_assets: [],
      };
      byKey.set(key, bundle);
    }
    bundle.check_assets.push(row.check_asset);
  }

  // Finalise: sort each bundle's assets by WO number and set
  // maintenance_check.maximo_wo_number when the group is a singleton.
  for (const bundle of byKey.values()) {
    bundle.check_assets.sort((a, b) =>
      a.work_order_number.localeCompare(b.work_order_number),
    );
    if (bundle.check_assets.length === 1) {
      bundle.maintenance_check.maximo_wo_number =
        bundle.check_assets[0]!.work_order_number;
    }
  }

  // Stable bundle order: site, then plan, then due_date, then frequency.
  const out = Array.from(byKey.values());
  out.sort((a, b) => {
    const ka = bundleSortKey(a.maintenance_check);
    const kb = bundleSortKey(b.maintenance_check);
    return ka.localeCompare(kb);
  });
  return out;
}

function bundleSortKey(c: MaintenanceCheckInsert): string {
  return [c.site_code, c.plan_code, c.due_date, c.frequency ?? ""].join("|");
}
