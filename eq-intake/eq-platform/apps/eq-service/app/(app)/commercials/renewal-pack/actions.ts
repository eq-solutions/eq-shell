'use server'

import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import { generateCustomerRenewalPack } from '@/lib/reports/customer-renewal-pack'
import { convertDocxToPdf } from '@/lib/reports/pdf-conversion'

/**
 * Phase 7 (stretch) — generate the year-end renewal pack on demand.
 *
 * Compiles five sections into one customer-facing document:
 *   1. Cover + executive summary
 *   2. Year in review (this year's scope items)
 *   3. Delivery summary (completed maintenance checks)
 *   4. Variations (approved + billed)
 *   5. Proposed scope for next year
 *
 * Admin-only — the pack is a high-stakes commercial artefact and the
 * default executive summary leans on bookkeeping accuracy. Lower roles
 * can still preview by switching to the per-customer scope statement
 * (Phase 8) which doesn't include the proposed-next-year section.
 *
 * Commercial-tier — gated on tenant_settings.commercial_features_enabled.
 */

const schema = z.object({
  customer_id: z.string().uuid(),
  review_year: z.string().min(1).max(16),
  next_year: z.string().min(1).max(16).optional(),
  format: z.enum(['docx', 'pdf']).default('docx'),
  executive_summary_override: z.string().max(4000).optional().nullable(),
})

function fyLabel(fy: string): string {
  if (/^\d{4}$/.test(fy)) return `CY ${fy}`
  return `FY ${fy}`
}

/**
 * Best-effort "next year" inference. CY '2026' → '2027'; AusFY
 * '2025-2026' → '2026-2027'. If we can't parse, default to passing the
 * caller's value through unchanged (operator should always be able to
 * override).
 */
function inferNextYear(fy: string): string {
  if (/^\d{4}$/.test(fy)) {
    return String(Number(fy) + 1)
  }
  const m = fy.match(/^(\d{4})-(\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    return `${a + 1}-${b + 1}`
  }
  return fy
}

export async function generateRenewalPackAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) {
      return { success: false as const, error: 'Admin role required to generate the renewal pack.' }
    }

    const parsed = schema.safeParse({
      customer_id: formData.get('customer_id'),
      review_year: formData.get('review_year'),
      next_year: formData.get('next_year') || undefined,
      format: formData.get('format') ?? 'docx',
      executive_summary_override: formData.get('executive_summary_override') || null,
    })
    if (!parsed.success) {
      return { success: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }
    const { customer_id, review_year, format, executive_summary_override } = parsed.data
    const next_year = parsed.data.next_year ?? inferNextYear(review_year)

    const { data: settingsRow } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!settingsRow?.commercial_features_enabled) {
      return { success: false as const, error: 'Renewal packs are a commercial-tier feature. Enable it in Admin → Settings first.' }
    }

    // Pull customer + scope rows for review/next year + completed checks
    // + variations in parallel. RLS gates each query to this tenant; we
    // also explicitly filter by customer_id to avoid mixing data.
    const [
      customerRes,
      reviewScopeRes,
      proposedScopeRes,
      checksRes,
      variationsRes,
    ] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, logo_url')
        .eq('id', customer_id)
        .maybeSingle(),
      supabase
        .from('contract_scopes')
        .select('scope_item, is_included, notes, sites(name)')
        .eq('customer_id', customer_id)
        .eq('financial_year', review_year)
        .order('is_included', { ascending: false })
        .order('scope_item'),
      supabase
        .from('contract_scopes')
        .select('scope_item, is_included, notes, sites(name)')
        .eq('customer_id', customer_id)
        .eq('financial_year', next_year)
        .eq('is_included', true)
        .order('scope_item'),
      // Completed checks for the customer's sites in the review year. We
      // approximate "in this year" by completed_at year — for AusFY values
      // that's a slight over-match, but operators can edit the doc.
      supabase
        .from('maintenance_checks')
        .select('id, custom_name, status, completed_at, sites!inner(name, customer_id), job_plans(name)')
        .eq('sites.customer_id', customer_id)
        .eq('status', 'complete')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }),
      supabase
        .from('contract_variations')
        .select('variation_number, title, status, value_approved, value_estimate, customer_ref')
        .eq('customer_id', customer_id)
        .eq('financial_year', review_year)
        .in('status', ['approved', 'billed'])
        .order('variation_number'),
    ])

    if (customerRes.error || !customerRes.data) {
      return { success: false as const, error: 'Customer not found.' }
    }

    type ScopeRow = {
      scope_item: string
      is_included: boolean
      notes: string | null
      sites: { name: string } | { name: string }[] | null
    }
    type CheckRow = {
      id: string
      custom_name: string | null
      status: string
      completed_at: string | null
      sites: { name: string; customer_id: string } | { name: string; customer_id: string }[] | null
      job_plans: { name: string } | { name: string }[] | null
    }
    type VariationRow = {
      variation_number: string
      title: string
      status: string
      value_approved: number | null
      value_estimate: number | null
      customer_ref: string | null
    }

    const reviewScope = (reviewScopeRes.data ?? []) as ScopeRow[]
    const proposedScope = (proposedScopeRes.data ?? []) as ScopeRow[]
    const checks = (checksRes.data ?? []) as CheckRow[]
    const variations = (variationsRes.data ?? []) as VariationRow[]

    // Filter checks to the review year by completed_at year. For CY years
    // this is exact; for AusFY (Jul-Jun) it's an approximation we accept.
    const yearForFilter = (() => {
      if (/^\d{4}$/.test(review_year)) return Number(review_year)
      const m = review_year.match(/^(\d{4})-(\d{4})$/)
      return m ? Number(m[2]) : new Date().getFullYear()
    })()
    const checksInYear = checks.filter(c => {
      if (!c.completed_at) return false
      return new Date(c.completed_at).getFullYear() === yearForFilter
    })

    function siteName(joined: ScopeRow['sites'] | CheckRow['sites']): string {
      if (!joined) return '—'
      if (Array.isArray(joined)) return joined[0]?.name ?? '—'
      return joined.name
    }
    function jobPlanName(joined: CheckRow['job_plans']): string | null {
      if (!joined) return null
      if (Array.isArray(joined)) return joined[0]?.name ?? null
      return joined.name
    }

    const customer = customerRes.data
    const docxBuffer = await generateCustomerRenewalPack({
      shellSettings: {
        companyName: settingsRow.report_company_name ?? settingsRow.product_name ?? 'EQ Solves',
        productName: settingsRow.product_name ?? 'EQ Solves Service',
        primaryColour: settingsRow.primary_colour ?? '#3DA8D8',
        deepColour: settingsRow.deep_colour ?? null,
        iceColour: settingsRow.ice_colour ?? null,
        inkColour: settingsRow.ink_colour ?? null,
        tenantLogoUrl: settingsRow.report_logo_url ?? settingsRow.logo_url ?? null,
        tenantLogoOnDarkUrl: settingsRow.report_logo_url_on_dark ?? settingsRow.logo_url_on_dark ?? null,
        showCover: settingsRow.report_show_cover_page ?? true,
        showContents: settingsRow.report_show_contents ?? true,
        showSummary: settingsRow.report_show_executive_summary ?? true,
        showSignoff: settingsRow.report_show_sign_off ?? true,
        complexity: (settingsRow.report_complexity ?? 'standard') as 'summary' | 'standard' | 'detailed',
        headerText: settingsRow.report_header_text ?? null,
        footerText: settingsRow.report_footer_text ?? null,
      },
      shellContext: {
        reportType: 'customer_renewal_pack',
        reportDate: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
        customerName: customer.name,
        siteName: null,
        siteAddress: null,
        customerLogoUrl: customer.logo_url ?? null,
        sitePhotoUrl: null,
      },
      reviewYear: review_year,
      nextYear: next_year,
      reviewYearDisplay: fyLabel(review_year),
      nextYearDisplay: fyLabel(next_year),
      reviewIncludedItems: reviewScope.filter(r => r.is_included).map(r => ({
        scope_item: r.scope_item,
        site_name: siteName(r.sites),
        notes: r.notes,
      })),
      reviewExcludedItems: reviewScope.filter(r => !r.is_included).map(r => ({
        scope_item: r.scope_item,
        site_name: siteName(r.sites),
        notes: r.notes,
      })),
      deliveredChecks: checksInYear.map(c => ({
        check_id: c.id,
        custom_name: c.custom_name,
        site_name: siteName(c.sites),
        status: c.status,
        completed_at: c.completed_at,
        job_plan_name: jobPlanName(c.job_plans),
      })),
      variations: variations.map(v => ({
        variation_number: v.variation_number,
        title: v.title,
        status: v.status,
        value: v.value_approved ?? v.value_estimate ?? null,
        customer_ref: v.customer_ref,
      })),
      proposedItems: proposedScope.map(r => ({
        scope_item: r.scope_item,
        site_name: siteName(r.sites),
        notes: r.notes,
      })),
      executiveSummaryOverride: executive_summary_override,
    })

    let outputBuffer: Buffer = docxBuffer
    let outputFilename = `${customer.name.replace(/[^\w-]+/g, '-')}-Renewal-Pack-${review_year}-to-${next_year}.docx`
    let outputContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (format === 'pdf') {
      const pdfBuffer = await convertDocxToPdf(docxBuffer)
      if (pdfBuffer) {
        outputBuffer = pdfBuffer
        outputFilename = outputFilename.replace(/\.docx$/, '.pdf')
        outputContentType = 'application/pdf'
      }
    }

    await logAuditEvent({
      action: 'export',
      entityType: 'contract_scope',
      summary: `Generated renewal pack for ${customer.name} (${fyLabel(review_year)} → ${fyLabel(next_year)})`,
      metadata: {
        customer_id,
        review_year,
        next_year,
        format,
        included_count: reviewScope.filter(r => r.is_included).length,
        excluded_count: reviewScope.filter(r => !r.is_included).length,
        proposed_count: proposedScope.length,
        delivered_count: checksInYear.length,
        variation_count: variations.length,
      },
    })

    return {
      success: true as const,
      filename: outputFilename,
      content_type: outputContentType,
      data_b64: outputBuffer.toString('base64'),
    }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}
