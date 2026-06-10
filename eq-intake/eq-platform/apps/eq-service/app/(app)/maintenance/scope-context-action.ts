'use server'

import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { getScopeContext } from '@/lib/scope-context/getScopeContext'
import type { ScopeContextResult } from '@/lib/scope-context/lookup'

const schema = z.object({
  customer_id: z.string().uuid(),
  site_id: z.string().uuid().optional().nullable(),
  job_plan_id: z.string().uuid().optional().nullable(),
  asset_id: z.string().uuid().optional().nullable(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

/**
 * Client-callable lookup of scope context. Used by CreateCheckForm to
 * surface the green / amber / red chip as the operator picks site +
 * maintenance plan, before they hit Create.
 *
 * Read-only; canWrite gate so anonymous users can't probe the register.
 */
export async function getScopeContextAction(
  formData: FormData,
): Promise<ScopeContextResult | { status: 'error'; label: string; detail: string; scope_id: null; matched_year: null; amount_for_year: null }> {
  const parsed = schema.safeParse({
    customer_id: formData.get('customer_id'),
    site_id: formData.get('site_id') || null,
    job_plan_id: formData.get('job_plan_id') || null,
    asset_id: formData.get('asset_id') || null,
    year: formData.get('year') || undefined,
  })
  if (!parsed.success) {
    return {
      status: 'error',
      label: 'Invalid input',
      detail: parsed.error.issues[0]?.message ?? 'Bad request.',
      scope_id: null,
      matched_year: null,
      amount_for_year: null,
    }
  }

  const { supabase, role } = await requireUser()
  if (!canWrite(role)) {
    return {
      status: 'error',
      label: 'Not authorised',
      detail: 'Need writer role.',
      scope_id: null,
      matched_year: null,
      amount_for_year: null,
    }
  }

  return getScopeContext(supabase, {
    customerId: parsed.data.customer_id,
    siteId: parsed.data.site_id ?? null,
    jobPlanId: parsed.data.job_plan_id ?? null,
    assetId: parsed.data.asset_id ?? null,
    year: parsed.data.year,
  })
}
