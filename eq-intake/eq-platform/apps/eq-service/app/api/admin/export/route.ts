/**
 * GET /api/admin/export
 *
 * Exports each canonical EQ table as a schema-shaped JSON payload, scoped
 * to the caller's tenant. Used by external pipelines (eq-intake, the
 * planned EQ Conduit, the ACB round-trip prototype) to fetch a canonical
 * snapshot of tenant data without needing direct DB access.
 *
 * Query params:
 *   ?entity=acb_test       → just that entity
 *   ?entity=acb_test,defect → multiple entities (comma-separated)
 *   (no entity param)      → every registered entity
 *
 * Auth: admin role on the caller's active tenant. Stub entries (entities
 * with no exporter wired yet) return empty rows with a note: field so
 * consumers can detect missing coverage without falling back to direct
 * DB queries.
 *
 * Output shape (single entity):
 *   { data: { schema_id, schema_version, count, rows, note? }, error: null }
 *
 * Output shape (multiple entities):
 *   { data: {
 *       tenant_id,
 *       exported_at,
 *       entities: {
 *         acb_test: { schema_id, schema_version, count, rows, note? },
 *         ...
 *       }
 *     }, error: null }
 */

import { NextRequest } from "next/server";
import { getApiUser, isAdmin } from "@/lib/api/auth";
import { ok, err, unauthorized, forbidden } from "@/lib/api/response";
import { ENTITY_EXPORTERS, ALL_ENTITY_NAMES } from "@/lib/admin/canonical-export";

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser();
    if (!user) return unauthorized();
    if (!tenantId) return forbidden();
    if (!isAdmin(role)) return forbidden();

    const entityParam = request.nextUrl.searchParams.get("entity");
    const entities = entityParam
      ? entityParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [...ALL_ENTITY_NAMES];

    // Validate every requested entity is known. Surface unknown entities
    // up-front rather than silently returning empty.
    const unknown = entities.filter((e) => !(e in ENTITY_EXPORTERS));
    if (unknown.length > 0) {
      return err(
        `Unknown entity: ${unknown.join(", ")}. Available: ${ALL_ENTITY_NAMES.join(", ")}.`,
        400,
      );
    }

    const exportedAt = new Date().toISOString();

    // Single-entity short-circuit so consumers can pipe straight into ajv
    // without unwrapping the multi-entity envelope.
    if (entities.length === 1) {
      const entity = entities[0]!;
      const result = await ENTITY_EXPORTERS[entity]!(supabase, tenantId);
      return ok({
        tenant_id: tenantId,
        exported_at: exportedAt,
        entity,
        ...result,
      });
    }

    // Multi-entity export. We run exporters serially (no client-side
    // transaction across PostgREST roundtrips) so a single broken
    // exporter must not nuke the whole snapshot — catch per entity and
    // emit an error stub so the consumer can see what failed without
    // losing the rest of the payload.
    const entityResults: Record<
      string,
      Awaited<ReturnType<(typeof ENTITY_EXPORTERS)[string]>>
    > = {};
    for (const entity of entities) {
      try {
        entityResults[entity] = await ENTITY_EXPORTERS[entity]!(supabase, tenantId);
      } catch (e) {
        entityResults[entity] = {
          schema_id: `internal:error:${entity}`,
          schema_version: "0",
          count: 0,
          rows: [],
          note: `exporter failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    return ok({
      tenant_id: tenantId,
      exported_at: exportedAt,
      consistency: "per-entity (serial select); cross-entity skew sub-second on idle tenant",
      entities: entityResults,
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : "Failed to export canonical data");
  }
}
