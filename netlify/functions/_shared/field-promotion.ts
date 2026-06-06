// Field promotion — the Cards -> Field "becomes a dispatchable resource" state-flip.
//
// Decision D-A/D-B/D-D (docs/cards-field-promotion-spec.md): promotion is a STATE
// TRANSITION on the staff row that already exists in the tenant data plane, NOT a
// cross-DB copy into a separate Field project. In the unified model app_data.staff
// IS Field's people table (Field reads the app_data.field_people view = staff WHERE
// field_status='active'), so promoting = flipping field_status. No INSERT, so the
// duplicate-person risk dissolves; no FIELD_SUPABASE project, no field_org_id.
//
// Decoupled from the admin UI on purpose (D-B): the "Add to Field" click calls
// promoteStaffToField today; an auto-promote trigger could call the same helper later
// without touching the bridge.
//
// β-aligned (sks-field-unification-arc): writes go through the tenant data plane via
// the service-role client — same two-plane pattern as the entity-* functions.
//
// Split into a pure DB op (applyFieldStatus — takes an injected client, unit-tested)
// and a routing wrapper (setFieldStatus — resolves the tenant plane). Mirrors the DI
// shape of seedDefaultGroups.
//
// NOT YET WIRED IN PRODUCTION — the consuming refactor + migration 0039 (which adds
// field_status + the field_people view) land together at F1. Deploying the refactor
// before 0039 is applied would 400 on the missing column. See the spec.

import { getRoutingById, getTenantDataClientById } from './tenant-routing.js';

export type FieldStatus = 'pending' | 'active' | 'rejected';

export interface FieldStatusResult {
  /** true if exactly the target staff row was updated. */
  ok: boolean;
  /** true if no active staff row matched (wrong tenant, archived, or bad id). */
  notFound: boolean;
  /** the tenant data-plane project ref, for the control-plane audit row. */
  projectRef: string;
}

/** https://<ref>.supabase.co -> <ref>. Empty string if unparseable. */
export function refFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * Pure data-plane op: flip field_status on the one matching active staff row.
 * Takes the supabase client as a parameter so it can be unit-tested with an
 * in-memory fake (no routing, no live DB). Scoped to active rows in the given
 * tenant — the service-role client bypasses RLS, so this explicit filter is the
 * tenant guard. Returns notFound (not a throw) when zero rows match.
 */
export async function applyFieldStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  staffId: string,
  tenantId: string,
  status: FieldStatus,
  byUserId: string,
): Promise<{ ok: boolean; notFound: boolean }> {
  const { data, error } = await db
    .schema('app_data')
    .from('staff')
    .update({ field_status: status, updated_by: byUserId })
    .eq('staff_id', staffId)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .select('staff_id');

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ staff_id: string }>;
  return { ok: rows.length > 0, notFound: rows.length === 0 };
}

/**
 * Resolve the caller's tenant data plane and flip field_status there.
 *
 * Throws TenantNotFoundError / TenantNotActiveError / TenantRoutingMisconfiguredError
 * from the routing layer — callers map those to HTTP via their tenantRoutingError().
 */
export async function setFieldStatus(
  staffId: string,
  tenantId: string,
  status: FieldStatus,
  byUserId: string,
): Promise<FieldStatusResult> {
  const routing = await getRoutingById(tenantId);
  const db = await getTenantDataClientById(tenantId);
  const res = await applyFieldStatus(db, staffId, tenantId, status, byUserId);
  return { ...res, projectRef: refFromUrl(routing.supabase_url) };
}

/** Promote: mark the staff row as a live, dispatchable Field resource. */
export function promoteStaffToField(
  staffId: string,
  tenantId: string,
  byUserId: string,
): Promise<FieldStatusResult> {
  return setFieldStatus(staffId, tenantId, 'active', byUserId);
}
