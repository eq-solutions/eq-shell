'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import {
  ARCHIVE_ENTITY_TYPES,
  TABLE_BY_ENTITY,
  countDependencies,
} from './helpers'

const entityTypeSchema = z.enum(ARCHIVE_ENTITY_TYPES)

// ============================================================
// Restore — flip is_active back to true. Reversible, safe.
// The trigger in migration 0035 clears deleted_at automatically.
// ============================================================
export async function restoreEntityAction(formData: FormData) {
  const parsed = z
    .object({
      entity_type: entityTypeSchema,
      entity_id: z.string().uuid(),
    })
    .safeParse({
      entity_type: formData.get('entity_type'),
      entity_id: formData.get('entity_id'),
    })

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { error: 'Not authorised.' }

  const table = TABLE_BY_ENTITY[parsed.data.entity_type]

  // Dynamic-table dispatch. With Database<> wired through, supabase.from(unionOfAllTables)
  // resolves the row type to the intersection of all 53 tables = never, which breaks
  // .update / .eq / .select. The runtime is correct (table is one of the 6 entity tables
  // declared in TABLE_BY_ENTITY); the typechecker just can't pick one. Cast to escape.
  // Proper fix is per-entity dispatch (switch over entity_type) — deferred until the
  // archive surface justifies the additional code.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dyn = supabase as any

  const { error } = await dyn
    .from(table)
    .update({ is_active: true })
    .eq('id', parsed.data.entity_id)
    .eq('tenant_id', tenantId)

  if (error) return { error: error.message }

  await logAuditEvent({
    action: 'update',
    entityType: parsed.data.entity_type,
    entityId: parsed.data.entity_id,
    summary: `Restored ${parsed.data.entity_type} from archive`,
  })

  revalidatePath('/admin/archive')
  return { ok: true }
}

// ============================================================
// Hard delete — permanent. Only allowed when the row has no
// active dependent children AND the user types the entity name
// to confirm. Dependency check mirrors what pg_cron enforces.
// ============================================================
export async function hardDeleteEntityAction(formData: FormData) {
  const parsed = z
    .object({
      entity_type: entityTypeSchema,
      entity_id: z.string().uuid(),
      confirm_name: z.string().min(1),
    })
    .safeParse({
      entity_type: formData.get('entity_type'),
      entity_id: formData.get('entity_id'),
      confirm_name: formData.get('confirm_name'),
    })

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { error: 'Not authorised.' }

  const table = TABLE_BY_ENTITY[parsed.data.entity_type]

  // maintenance_checks doesn't have a `name` column — the human label is in
  // `custom_name`. Alias it via Supabase's column-renaming select syntax so
  // the rest of this action treats `row.name` uniformly across entities.
  const selectCols = table === 'maintenance_checks'
    ? 'id, name:custom_name, is_active, tenant_id'
    : 'id, name, is_active, tenant_id'

  // See restoreEntityAction above for why this cast is necessary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dyn = supabase as any

  // Confirm row exists, still archived, tenant-scoped, name matches
  const { data: row, error: fetchErr } = await dyn
    .from(table)
    .select(selectCols)
    .eq('id', parsed.data.entity_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr) return { error: fetchErr.message }
  if (!row) return { error: 'Row not found.' }
  if (row.is_active) return { error: 'Row is not archived. Archive it first.' }
  if ((row.name ?? '').trim() !== parsed.data.confirm_name.trim()) {
    return { error: 'Confirmation name did not match.' }
  }

  // Dependency check — same rule the cron applies
  const depCount = await countDependencies(supabase, parsed.data.entity_type, parsed.data.entity_id)
  if (depCount > 0) {
    return { error: `Cannot delete: ${depCount} dependent row${depCount === 1 ? '' : 's'} still exist. Remove them first.` }
  }

  const { error: delErr } = await dyn
    .from(table)
    .delete()
    .eq('id', parsed.data.entity_id)
    .eq('tenant_id', tenantId)

  if (delErr) return { error: delErr.message }

  await logAuditEvent({
    action: 'delete',
    entityType: parsed.data.entity_type,
    entityId: parsed.data.entity_id,
    summary: `Hard-deleted ${parsed.data.entity_type}: ${row.name}`,
  })

  revalidatePath('/admin/archive')
  return { ok: true }
}

// ============================================================
// Cascade archive — flip is_active=false on a parent AND all
// children in one go. Used by the "Archive customer/site" flow
// so Royce doesn't have to delete leaves first. Fully reversible
// inside the grace window by restoring each row.
// ============================================================
export async function cascadeArchiveAction(formData: FormData) {
  const parsed = z
    .object({
      entity_type: z.enum(['customer', 'site']),
      entity_id: z.string().uuid(),
    })
    .safeParse({
      entity_type: formData.get('entity_type'),
      entity_id: formData.get('entity_id'),
    })

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { error: 'Not authorised.' }

  const archivedCounts = { customer: 0, site: 0, asset: 0 }

  if (parsed.data.entity_type === 'customer') {
    const { data: sites } = await supabase
      .from('sites')
      .select('id')
      .eq('customer_id', parsed.data.entity_id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    const siteIds = (sites ?? []).map((s) => s.id as string)

    if (siteIds.length > 0) {
      const { data: assetUpdate } = await supabase
        .from('assets')
        .update({ is_active: false })
        .in('site_id', siteIds)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .select('id')
      archivedCounts.asset = (assetUpdate ?? []).length

      const { data: siteUpdate } = await supabase
        .from('sites')
        .update({ is_active: false })
        .in('id', siteIds)
        .eq('tenant_id', tenantId)
        .select('id')
      archivedCounts.site = (siteUpdate ?? []).length
    }

    const { error: custErr } = await supabase
      .from('customers')
      .update({ is_active: false })
      .eq('id', parsed.data.entity_id)
      .eq('tenant_id', tenantId)
    if (custErr) return { error: custErr.message }
    archivedCounts.customer = 1
  } else {
    // site → assets
    const { data: assetUpdate } = await supabase
      .from('assets')
      .update({ is_active: false })
      .eq('site_id', parsed.data.entity_id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .select('id')
    archivedCounts.asset = (assetUpdate ?? []).length

    const { error: siteErr } = await supabase
      .from('sites')
      .update({ is_active: false })
      .eq('id', parsed.data.entity_id)
      .eq('tenant_id', tenantId)
    if (siteErr) return { error: siteErr.message }
    archivedCounts.site = 1
  }

  await logAuditEvent({
    action: 'delete',
    entityType: parsed.data.entity_type,
    entityId: parsed.data.entity_id,
    summary: `Cascade-archived ${parsed.data.entity_type}: ${archivedCounts.customer} customer, ${archivedCounts.site} site(s), ${archivedCounts.asset} asset(s)`,
    metadata: archivedCounts,
  })

  revalidatePath('/admin/archive')
  revalidatePath('/customers')
  revalidatePath('/sites')
  revalidatePath('/assets')
  return { ok: true, counts: archivedCounts }
}

// ============================================================
// Update tenant grace-period setting (30/60/90 days only)
// ============================================================
export async function updateGracePeriodAction(formData: FormData) {
  const parsed = z
    .object({
      days: z.coerce.number().refine((n) => [30, 60, 90].includes(n), {
        error: 'Grace period must be 30, 60, or 90 days.',
      }),
    })
    .safeParse({ days: formData.get('days') })

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { error: 'Not authorised.' }

  const { error } = await supabase
    .from('tenant_settings')
    .upsert(
      { tenant_id: tenantId, archive_grace_period_days: parsed.data.days },
      { onConflict: 'tenant_id' },
    )

  if (error) return { error: error.message }

  await logAuditEvent({
    action: 'update',
    entityType: 'tenant_settings',
    summary: `Changed archive grace period to ${parsed.data.days} days`,
  })

  revalidatePath('/admin/archive')
  revalidatePath('/admin/archive/settings')
  return { ok: true }
}
