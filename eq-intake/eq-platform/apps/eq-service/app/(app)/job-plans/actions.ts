'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { zodToErrorMap } from '@/lib/utils/zodErrors'
import {
  CreateJobPlanSchema,
  UpdateJobPlanSchema,
  CreateJobPlanItemSchema,
  UpdateJobPlanItemSchema,
} from '@/lib/validations/job-plan'
import { STARTER_JOB_PLANS } from '@/lib/seed/starter-job-plans'

export async function createJobPlanAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') || null,
      name: formData.get('name'),
      code: formData.get('code') || null,
      type: formData.get('type') || null,
      description: formData.get('description') || null,
      frequency: formData.get('frequency') || null,
    }

    const parsed = CreateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    // Return the new id so the form can stay open in "just-created" mode
    // and reveal the Items section (UX audit PR #149 §A.3 / §2.3). Without
    // this the form auto-closes on create and admins routinely save plans
    // with zero tasks, then discover empty per-asset task lists on site.
    const { data: created, error } = await supabase
      .from('job_plans')
      .insert({ ...parsed.data, tenant_id: tenantId })
      .select('id')
      .single()

    if (error || !created) return { success: false, error: error?.message ?? 'Failed to create maintenance plan.' }

    await logAuditEvent({ action: 'create', entityType: 'job_plan', entityId: created.id, summary: `Created maintenance plan "${parsed.data.name}"` })
    revalidatePath('/job-plans')
    return { success: true, data: { id: created.id as string } }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateJobPlanAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') || null,
      name: formData.get('name'),
      code: formData.get('code') || null,
      type: formData.get('type') || null,
      description: formData.get('description') || null,
      frequency: formData.get('frequency') || null,
    }

    const parsed = UpdateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const { error } = await supabase
      .from('job_plans')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'job_plan', entityId: id, summary: 'Updated maintenance plan' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importJobPlansAction(
  jobPlans: {
    name: string
    code: string | null
    type: string | null
    site_id: string
    description: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (jobPlans.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (jobPlans.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof jobPlans = []

    for (let i = 0; i < jobPlans.length; i++) {
      const row = jobPlans[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    const insertRows = validRows.map((r) => ({
      name: r.name,
      code: r.code,
      type: r.type,
      site_id: r.site_id || null,
      description: r.description,
      tenant_id: tenantId,
    }))
    const { error } = await supabase.from('job_plans').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'job_plan', summary: `Imported ${validRows.length} maintenance plans from CSV` })
    revalidatePath('/job-plans')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}

export async function toggleJobPlanActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('job_plans')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'job_plan', entityId: id, summary: isActive ? 'Reactivated maintenance plan' : 'Deactivated maintenance plan' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// --- Maintenance Plan Items ---

export async function createJobPlanItemAction(jobPlanId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      description: formData.get('description'),
      sort_order: Number(formData.get('sort_order') ?? 0),
      is_required: formData.get('is_required') === 'true',
      asset_id: formData.get('asset_id') || null,
      dark_site: formData.get('dark_site') === 'true',
      freq_monthly: formData.get('freq_monthly') === 'true',
      freq_quarterly: formData.get('freq_quarterly') === 'true',
      freq_semi_annual: formData.get('freq_semi_annual') === 'true',
      freq_annual: formData.get('freq_annual') === 'true',
      freq_2yr: formData.get('freq_2yr') === 'true',
      freq_3yr: formData.get('freq_3yr') === 'true',
      freq_5yr: formData.get('freq_5yr') === 'true',
      freq_8yr: formData.get('freq_8yr') === 'true',
      freq_10yr: formData.get('freq_10yr') === 'true',
    }

    const parsed = CreateJobPlanItemSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const { error } = await supabase
      .from('job_plan_items')
      .insert({ ...parsed.data, job_plan_id: jobPlanId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'job_plan_item', summary: 'Added maintenance plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateJobPlanItemAction(jobPlanId: string, itemId: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Only include keys that are actually present in the FormData so callers
    // can do partial updates (e.g. updating just frequency flags from the
    // master register without touching description / sort_order).
    const raw: Record<string, unknown> = {}
    if (formData.has('description')) raw.description = formData.get('description')
    if (formData.has('sort_order')) raw.sort_order = Number(formData.get('sort_order') ?? 0)
    if (formData.has('is_required')) raw.is_required = formData.get('is_required') === 'true'
    if (formData.has('dark_site')) raw.dark_site = formData.get('dark_site') === 'true'
    if (formData.has('freq_monthly')) raw.freq_monthly = formData.get('freq_monthly') === 'true'
    if (formData.has('freq_quarterly')) raw.freq_quarterly = formData.get('freq_quarterly') === 'true'
    if (formData.has('freq_semi_annual')) raw.freq_semi_annual = formData.get('freq_semi_annual') === 'true'
    if (formData.has('freq_annual')) raw.freq_annual = formData.get('freq_annual') === 'true'
    if (formData.has('freq_2yr')) raw.freq_2yr = formData.get('freq_2yr') === 'true'
    if (formData.has('freq_3yr')) raw.freq_3yr = formData.get('freq_3yr') === 'true'
    if (formData.has('freq_5yr')) raw.freq_5yr = formData.get('freq_5yr') === 'true'
    if (formData.has('freq_8yr')) raw.freq_8yr = formData.get('freq_8yr') === 'true'
    if (formData.has('freq_10yr')) raw.freq_10yr = formData.get('freq_10yr') === 'true'

    const parsed = UpdateJobPlanItemSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const { error } = await supabase
      .from('job_plan_items')
      .update(parsed.data)
      .eq('id', itemId)
      .eq('job_plan_id', jobPlanId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'job_plan_item', entityId: itemId, summary: 'Updated maintenance plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteJobPlanItemAction(jobPlanId: string, itemId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('job_plan_items')
      .delete()
      .eq('id', itemId)
      .eq('job_plan_id', jobPlanId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'job_plan_item', entityId: itemId, summary: 'Deleted maintenance plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// --- Import / Upsert Maintenance Plan Items (CSV round-trip) ---

interface ImportJobPlanItemRow {
  /** If present and non-empty → update. If blank → create. */
  item_id: string | null
  /** Required for creates. Used for update ownership checks. */
  plan_id: string | null
  description: string | null
  sort_order: number | null
  is_required: boolean
  dark_site: boolean
  freq_monthly: boolean
  freq_quarterly: boolean
  freq_semi_annual: boolean
  freq_annual: boolean
  freq_2yr: boolean
  freq_3yr: boolean
  freq_5yr: boolean
  freq_8yr: boolean
  freq_10yr: boolean
}

/**
 * Bulk upsert maintenance plan items from a CSV round-trip.
 *
 * Rows with a valid `item_id` → update the matching row.
 * Rows without `item_id` but with `plan_id` → create new.
 * Rows missing both → row-level error.
 *
 * The CSV is produced by the Items Register's "Export CSV" button which
 * includes `item_id` and `plan_id` as the first two columns.
 */
export async function importJobPlanItemsAction(
  items: ImportJobPlanItemRow[]
): Promise<{
  success: boolean
  imported: number
  rowErrors: string[]
  error?: string
}> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, imported: 0, rowErrors: [], error: 'Insufficient permissions.' }

    if (items.length === 0) return { success: false, imported: 0, rowErrors: [], error: 'No rows to import.' }
    if (items.length > 500) return { success: false, imported: 0, rowErrors: [], error: 'Maximum 500 rows per import.' }

    const rowErrors: string[] = []
    let updated = 0
    let created = 0

    for (let i = 0; i < items.length; i++) {
      const row = items[i]
      const rowNum = i + 1

      if (!row.description?.trim()) {
        rowErrors.push(`Row ${rowNum}: Description is required.`)
        continue
      }

      const payload = {
        description: row.description.trim(),
        sort_order: row.sort_order ?? 0,
        is_required: row.is_required,
        dark_site: row.dark_site,
        freq_monthly: row.freq_monthly,
        freq_quarterly: row.freq_quarterly,
        freq_semi_annual: row.freq_semi_annual,
        freq_annual: row.freq_annual,
        freq_2yr: row.freq_2yr,
        freq_3yr: row.freq_3yr,
        freq_5yr: row.freq_5yr,
        freq_8yr: row.freq_8yr,
        freq_10yr: row.freq_10yr,
      }

      if (row.item_id?.trim()) {
        // UPDATE existing item — RLS ensures tenant isolation.
        const { error } = await supabase
          .from('job_plan_items')
          .update(payload)
          .eq('id', row.item_id.trim())

        if (error) {
          rowErrors.push(`Row ${rowNum}: ${error.message}`)
        } else {
          updated++
        }
      } else if (row.plan_id?.trim()) {
        // CREATE new item under the specified plan.
        const { error } = await supabase
          .from('job_plan_items')
          .insert({
            ...payload,
            job_plan_id: row.plan_id.trim(),
            tenant_id: tenantId,
          })

        if (error) {
          rowErrors.push(`Row ${rowNum}: ${error.message}`)
        } else {
          created++
        }
      } else {
        rowErrors.push(`Row ${rowNum}: Needs either Item ID (to update) or Plan ID (to create).`)
      }
    }

    const total = updated + created
    if (total > 0) {
      await logAuditEvent({
        action: 'update',
        entityType: 'job_plan_item',
        summary: `CSV import: ${updated} updated, ${created} created (${rowErrors.length} errors)`,
      })
      revalidatePath('/job-plans')
      revalidatePath('/job-plans/items')
    }

    return { success: true, imported: total, rowErrors }
  } catch (e: unknown) {
    return { success: false, imported: 0, rowErrors: [], error: (e as Error).message }
  }
}

// --- Starter Maintenance Plan seed (one-click) ---------------------------

/**
 * Seed the tenant with the 5 starter maintenance plans + their items.
 *
 * Surfaced as a one-click CTA on /job-plans (when the tenant has zero plans)
 * and on the SetupChecklist. Idempotent — if a starter plan with the same
 * code (e.g. `STARTER-SWB-ANNUAL`) already exists in this tenant, we skip
 * it. So clicking the button twice is safe; clicking it after the admin has
 * customised one starter plan won't duplicate it.
 *
 * Returns the count of plans created so the caller can render a friendly
 * "Created N plans" toast.
 *
 * UX audit PR #149 §A.4 / §3.3 — "Set up a maintenance plan" was the hardest
 * step on the setup checklist. Pre-seeding reasonable starter plans gets new
 * tenants through the gate in seconds.
 */
export async function seedStarterJobPlansAction(): Promise<{
  success: boolean
  error?: string
  plansCreated: number
  itemsCreated: number
  skipped: string[]
}> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.', plansCreated: 0, itemsCreated: 0, skipped: [] }
    }

    // Find which starter codes already exist for this tenant — skip those.
    const codes = STARTER_JOB_PLANS.map((p) => p.code)
    const { data: existing, error: lookupErr } = await supabase
      .from('job_plans')
      .select('code')
      .in('code', codes)

    if (lookupErr) {
      return { success: false, error: lookupErr.message, plansCreated: 0, itemsCreated: 0, skipped: [] }
    }
    const existingCodes = new Set((existing ?? []).map((r) => r.code))

    let plansCreated = 0
    let itemsCreated = 0
    const skipped: string[] = []

    for (const tpl of STARTER_JOB_PLANS) {
      if (existingCodes.has(tpl.code)) {
        skipped.push(tpl.code)
        continue
      }

      const { data: created, error: planErr } = await supabase
        .from('job_plans')
        .insert({
          tenant_id: tenantId,
          name: tpl.name,
          code: tpl.code,
          type: tpl.type,
          description: tpl.description,
          frequency: tpl.frequency,
          // Global plans — no site / customer scope. Admin can convert any
          // starter to site- or customer-scoped after the fact.
          site_id: null,
        })
        .select('id')
        .single()

      if (planErr || !created) {
        // Don't bail out the whole batch — log + continue so the other
        // starters still land. The audit summary at the end reflects what
        // actually wrote.
        skipped.push(`${tpl.code} (insert failed: ${planErr?.message ?? 'unknown'})`)
        continue
      }
      plansCreated++

      // Insert items in one batch.
      const itemRows = tpl.items.map((i) => ({
        tenant_id: tenantId,
        job_plan_id: created.id,
        description: i.description,
        sort_order: i.sort_order,
        is_required: i.is_required,
        freq_annual: i.freq_annual ?? false,
        freq_semi_annual: i.freq_semi_annual ?? false,
        freq_quarterly: i.freq_quarterly ?? false,
        freq_monthly: i.freq_monthly ?? false,
      }))
      const { error: itemsErr } = await supabase.from('job_plan_items').insert(itemRows)
      if (itemsErr) {
        // Plan landed but items failed — surface as a skip note. The plan
        // will still appear; the admin can add items manually.
        skipped.push(`${tpl.code} items (insert failed: ${itemsErr.message})`)
        continue
      }
      itemsCreated += itemRows.length
    }

    if (plansCreated > 0) {
      await logAuditEvent({
        action: 'create',
        entityType: 'job_plan',
        summary: `Seeded ${plansCreated} starter maintenance plans (${itemsCreated} items, ${skipped.length} skipped)`,
      })
      revalidatePath('/job-plans')
      revalidatePath('/dashboard')
    }

    return { success: true, plansCreated, itemsCreated, skipped }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, plansCreated: 0, itemsCreated: 0, skipped: [] }
  }
}
