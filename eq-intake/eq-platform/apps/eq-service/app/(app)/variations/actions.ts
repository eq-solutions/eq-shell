'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import type { ContractVariationStatus } from '@/lib/types'

/**
 * Phase 4 of the contract-scope bridge plan — variations register.
 *
 * Out-of-scope work (and ad-hoc work that the customer agrees to bill
 * separately) gets captured here as a contract variation. The lifecycle:
 *
 *   draft  → quoted → approved → billed
 *          ↘ rejected
 *          ↘ cancelled (any state)
 *
 * The register surfaces in /variations for tenants on the commercial tier
 * (tenant_settings.commercial_features_enabled). The DB table itself is
 * universal — flipping the flag off doesn't lose data.
 */

const STATUS_VALUES = ['draft', 'quoted', 'approved', 'rejected', 'billed', 'cancelled'] as const

const createSchema = z.object({
  customer_id: z.string().uuid(),
  site_id: z.string().uuid().optional().nullable(),
  contract_scope_id: z.string().uuid().optional().nullable(),
  variation_number: z.string().trim().min(1).max(64).optional().nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  financial_year: z.string().trim().max(16).optional().nullable(),
  value_estimate: z.coerce.number().nonnegative().optional().nullable(),
  value_approved: z.coerce.number().nonnegative().optional().nullable(),
  customer_ref: z.string().trim().max(64).optional().nullable(),
  source_check_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

const updateSchema = createSchema.partial()

/**
 * Read tenant.commercial_features_enabled. Variations can be queried at
 * any time, but **mutations** are restricted to commercial-tier tenants
 * — keeps the UI consistent with the gate on /contract-scope.
 */
async function assertCommercialTier(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, tenantId } = await requireUser()
  const { data } = await supabase
    .from('tenant_settings')
    .select('commercial_features_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data?.commercial_features_enabled) {
    return { ok: false, error: 'Variations register is a commercial-tier feature. Enable it in Admin → Settings first.' }
  }
  return { ok: true }
}

export async function createVariationAction(formData: FormData) {
  try {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }
    const tier = await assertCommercialTier()
    if (!tier.ok) return { success: false, error: tier.error }

    const parsed = createSchema.safeParse({
      customer_id: formData.get('customer_id'),
      site_id: formData.get('site_id') || null,
      contract_scope_id: formData.get('contract_scope_id') || null,
      variation_number: (formData.get('variation_number') as string) || null,
      title: formData.get('title'),
      description: formData.get('description') || null,
      financial_year: formData.get('financial_year') || null,
      value_estimate: formData.get('value_estimate') || null,
      value_approved: formData.get('value_approved') || null,
      customer_ref: formData.get('customer_ref') || null,
      source_check_id: formData.get('source_check_id') || null,
      notes: formData.get('notes') || null,
    })
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }

    // Resolve variation_number — auto-generate if blank, using the year
    // helper. Year is derived from financial_year (CY or AusFY) when
    // present; falls back to today's calendar year.
    let variationNumber = parsed.data.variation_number
    if (!variationNumber) {
      const fyYear = (() => {
        const fy = parsed.data.financial_year ?? ''
        if (/^\d{4}$/.test(fy)) return Number(fy)
        const m = fy.match(/^(\d{4})-(\d{4})$/)
        if (m) return Number(m[1])
        return new Date().getFullYear()
      })()
      const { data: nextNum, error: nextErr } = await supabase
        .rpc('next_variation_number', { p_tenant_id: tenantId, p_year: fyYear })
      if (nextErr) return { success: false, error: nextErr.message }
      variationNumber = nextNum as string
    }

    const insertRow = {
      tenant_id: tenantId,
      customer_id: parsed.data.customer_id,
      site_id: parsed.data.site_id ?? null,
      contract_scope_id: parsed.data.contract_scope_id ?? null,
      variation_number: variationNumber,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      financial_year: parsed.data.financial_year ?? null,
      value_estimate: parsed.data.value_estimate ?? null,
      value_approved: parsed.data.value_approved ?? null,
      customer_ref: parsed.data.customer_ref ?? null,
      source_check_id: parsed.data.source_check_id ?? null,
      notes: parsed.data.notes ?? null,
      created_by: user.id,
      status: 'draft' as ContractVariationStatus,
    }

    const { data: inserted, error } = await supabase
      .from('contract_variations')
      .insert(insertRow)
      .select('id, variation_number')
      .single()
    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'create',
      entityType: 'contract_variation',
      entityId: inserted.id,
      summary: `Created variation ${inserted.variation_number}: ${parsed.data.title}`,
      metadata: {
        variation_number: inserted.variation_number,
        customer_id: parsed.data.customer_id,
        source_check_id: parsed.data.source_check_id ?? null,
      },
    })
    revalidatePath('/variations')
    return { success: true, id: inserted.id, variation_number: inserted.variation_number }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateVariationAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }
    const tier = await assertCommercialTier()
    if (!tier.ok) return { success: false, error: tier.error }

    const parsed = updateSchema.safeParse({
      customer_id: formData.get('customer_id') || undefined,
      site_id: formData.get('site_id') || null,
      contract_scope_id: formData.get('contract_scope_id') || null,
      variation_number: (formData.get('variation_number') as string) || undefined,
      title: formData.get('title') || undefined,
      description: formData.get('description') || null,
      financial_year: formData.get('financial_year') || null,
      value_estimate: formData.get('value_estimate') || null,
      value_approved: formData.get('value_approved') || null,
      customer_ref: formData.get('customer_ref') || null,
      source_check_id: formData.get('source_check_id') || null,
      notes: formData.get('notes') || null,
    })
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }

    // parsed.data has variation_number?: string | null | undefined; the
    // generated Update type allows string | undefined but not null. The
    // column is nullable in Postgres so null is correct at runtime —
    // cast through unknown to bridge the generator quirk.
    const { error } = await supabase
      .from('contract_variations')
      .update(parsed.data as unknown as { variation_number?: string })
      .eq('id', id)
    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'contract_variation',
      entityId: id,
      summary: `Updated variation ${parsed.data.title ?? ''}`.trim(),
    })
    revalidatePath('/variations')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function setVariationStatusAction(
  id: string,
  newStatus: ContractVariationStatus,
  reason: string | null,
) {
  try {
    if (!STATUS_VALUES.includes(newStatus)) {
      return { success: false, error: 'Invalid status.' }
    }
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }
    const tier = await assertCommercialTier()
    if (!tier.ok) return { success: false, error: tier.error }

    const { data: existing, error: readErr } = await supabase
      .from('contract_variations')
      .select('id, status, variation_number')
      .eq('id', id)
      .maybeSingle()
    if (readErr || !existing) {
      return { success: false, error: readErr?.message ?? 'Variation not found.' }
    }
    if (existing.status === newStatus) return { success: true }

    // Stamp the lifecycle timestamps the UI shows in the row detail.
    const now = new Date().toISOString()
    const update: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'approved' && !((existing as unknown) as Record<string, unknown>).approved_at) update.approved_at = now
    if (newStatus === 'rejected') update.rejected_at = now
    if (newStatus === 'billed') update.billed_at = now

    const { error } = await supabase
      .from('contract_variations')
      .update(update)
      .eq('id', id)
    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'contract_variation',
      entityId: id,
      summary: `${existing.status} → ${newStatus}: variation ${existing.variation_number}`,
      metadata: {
        status_old: existing.status,
        status_new: newStatus,
        reason: reason ?? null,
      },
    })
    revalidatePath('/variations')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteVariationAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin role required.' }
    const tier = await assertCommercialTier()
    if (!tier.ok) return { success: false, error: tier.error }

    const { error } = await supabase
      .from('contract_variations')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'delete',
      entityType: 'contract_variation',
      entityId: id,
      summary: 'Deleted variation',
    })
    revalidatePath('/variations')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
