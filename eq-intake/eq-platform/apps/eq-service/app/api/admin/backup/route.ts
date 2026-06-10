/**
 * GET /api/admin/backup
 *
 * Returns a ZIP file containing one JSON file per canonical entity,
 * scoped to the caller's tenant. Same exporters as /api/admin/export,
 * but packaged for download as a single tenant snapshot.
 *
 * Filename: eq-service-backup-{tenant-id}-{YYYY-MM-DD-HHmmss}.zip
 *
 * ZIP layout:
 *   manifest.json           ← tenant id, exported_at, row counts, schema ids
 *   customer.json           ← canonical rows for that entity
 *   site.json
 *   ...
 *
 * Auth: admin role on the caller's active tenant.
 *
 * Snapshot consistency note: entities are exported in dependency order
 * (settings → customers → sites → assets → checks → tasks → tests) so
 * cross-entity references are stable for an idle tenant. A proper
 * Postgres repeatable-read transaction across all selects requires an
 * RPC and is deferred to A.3 follow-up — at SKS's current write rate
 * the per-entity skew is sub-second and acceptable for backups.
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getApiUser, isAdmin } from "@/lib/api/auth";
import { unauthorized, forbidden, err } from "@/lib/api/response";
import { ENTITY_EXPORTERS, ALL_ENTITY_NAMES } from "@/lib/admin/canonical-export";

// Dependency-order export so referenced rows land before referencing rows.
// Stubs are still emitted (empty rows + note) so consumers see the full
// canonical surface, not just what's wired today.
const EXPORT_ORDER: readonly string[] = [
  "customer",
  "service_contract",
  "site",
  "contact",
  "asset",
  "maintenance_plan",
  "maintenance_plan_item",
  "maintenance_check",
  "check_asset",
  "check_item",
  "contract_scope",
  "pm_calendar",
  "acb_test",
  "nsx_test",
  "rcd_test",
  "defect",
  "attachment",
];

function backupFilename(tenantId: string, exportedAt: Date): string {
  const yyyy = exportedAt.getUTCFullYear();
  const mm = String(exportedAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(exportedAt.getUTCDate()).padStart(2, "0");
  const hh = String(exportedAt.getUTCHours()).padStart(2, "0");
  const mi = String(exportedAt.getUTCMinutes()).padStart(2, "0");
  const ss = String(exportedAt.getUTCSeconds()).padStart(2, "0");
  const shortTenant = tenantId.slice(0, 8);
  return `eq-service-backup-${shortTenant}-${yyyy}${mm}${dd}-${hh}${mi}${ss}.zip`;
}

export async function GET(_request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser();
    if (!user) return unauthorized();
    if (!tenantId) return forbidden();
    if (!isAdmin(role)) return forbidden();

    const exportedAt = new Date();
    const exportedAtIso = exportedAt.toISOString();

    // Run entity exporters in dependency order. Each populates one .json
    // file inside the ZIP plus a manifest entry.
    const zip = new JSZip();
    const manifestEntities: Record<
      string,
      { schema_id: string; schema_version: string; count: number; note?: string }
    > = {};

    const knownEntities = EXPORT_ORDER.filter((e) => e in ENTITY_EXPORTERS);
    const failures: string[] = [];
    for (const entity of knownEntities) {
      // Per-entity try/catch: a single broken exporter should not kill
      // the whole snapshot. Failed exporters land an empty .json with a
      // note so the user (and any future restore tool) can see the gap.
      let result;
      try {
        result = await ENTITY_EXPORTERS[entity]!(supabase, tenantId);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${entity}: ${message}`);
        result = {
          schema_id: `internal:error:${entity}`,
          schema_version: "0",
          count: 0,
          rows: [],
          note: `exporter failed: ${message}`,
        };
      }
      const file = {
        schema_id: result.schema_id,
        schema_version: result.schema_version,
        tenant_id: tenantId,
        exported_at: exportedAtIso,
        entity,
        count: result.count,
        rows: result.rows,
        ...(result.note ? { note: result.note } : {}),
      };
      zip.file(`${entity}.json`, JSON.stringify(file, null, 2));
      manifestEntities[entity] = {
        schema_id: result.schema_id,
        schema_version: result.schema_version,
        count: result.count,
        ...(result.note ? { note: result.note } : {}),
      };
    }

    // Surface any entities the route forgot to put in EXPORT_ORDER —
    // belt-and-braces against drift between this file and the registry.
    const missing = ALL_ENTITY_NAMES.filter((e) => !knownEntities.includes(e));
    if (missing.length > 0) {
      manifestEntities["_export_order_drift"] = {
        schema_id: "internal",
        schema_version: "0",
        count: missing.length,
        note: `Entities not listed in EXPORT_ORDER and skipped: ${missing.join(", ")}`,
      };
    }

    const manifest = {
      tenant_id: tenantId,
      exported_at: exportedAtIso,
      exported_by: user.id,
      generator: "eq-service /api/admin/backup",
      generator_version: "1.0.0",
      consistency: "per-entity (serial select); cross-entity skew sub-second on idle tenant",
      entity_count: knownEntities.length,
      failure_count: failures.length,
      ...(failures.length > 0 ? { failures } : {}),
      entities: manifestEntities,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const filename = backupFilename(tenantId, exportedAt);

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(blob.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : "Failed to build backup");
  }
}
