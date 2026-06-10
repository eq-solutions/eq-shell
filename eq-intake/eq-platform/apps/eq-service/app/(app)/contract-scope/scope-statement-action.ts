'use server'

import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite } from '@/lib/utils/roles'
import { generateCustomerScopeStatement } from '@/lib/reports/customer-scope-statement'
import { convertDocxToPdf } from '@/lib/reports/pdf-conversion'

/**
 * Phase 8 of the contract-scope bridge plan — generate the customer-facing
 * scope statement on demand.
 *
 * Returns a base64-encoded blob + suggested filename so the client can
 * trigger a download without round-tripping through Storage. (Storing the
 * statement in the attachments bucket would add an extra hop and an
 * archival concern that the operator hasn't asked for; if we want
 * "send to customer" later we'll add that as a separate path.)
 *
 * Commercial-tier — gated on tenant_settings.commercial_features_enabled.
 */

const schema = z.object({
  customer_id: z.string().uuid(),
  financial_year: z.string().min(1).max(16),
  format: z.enum(['docx', 'pdf']).default('docx'),
  /** Optional intro override for this run — defaults to the canned text. */
  intro_override: z.string().max(2000).optional().nullable(),
  /**
   * When true, include approved variations for this customer + FY in the
   * statement. Default true; toggle off if the customer-facing pack
   * shouldn't surface variations yet.
   */
  include_variations: z.coerce.boolean().default(true),
})

function fyLabel(fy: string) {
  if (/^\d{4}$/.test(fy)) return `CY ${fy}`
  return `FY ${fy}`
}

export async function generateScopeStatementAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const parsed = schema.safeParse({
      customer_id: formData.get('customer_id'),
      financial_year: formData.get('financial_year'),
      format: formData.get('format') ?? 'docx',
      intro_override: formData.get('intro_override') || null,
      include_variations: formData.get('include_variations') ?? true,
    })
    if (!parsed.success) {
      return { success: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }
    const { customer_id, financial_year, format, intro_override, include_variations } = parsed.data

    // Commercial-tier gate — same shape as the rest of the bridge plan.
    const { data: settingsRow } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!settingsRow?.commercial_features_enabled) {
      return { success: false as const, error: 'Customer scope statements are a commercial-tier feature. Enable it in Admin → Settings first.' }
    }

    // Resolve customer + scope rows + (optionally) approved variations in
    // parallel. Each query is RLS-gated so we don't need to filter by
    // tenant_id manually.
    const [customerRes, scopeRes, variationsRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, logo_url')
        .eq('id', customer_id)
        .maybeSingle(),
      supabase
        .from('contract_scopes')
        .select('scope_item, is_included, notes, sites(name)')
        .eq('customer_id', customer_id)
        .eq('financial_year', financial_year)
        .order('is_included', { ascending: false })
        .order('scope_item'),
      include_variations
        ? supabase
            .from('contract_variations')
            .select('variation_number, title, value_approved, value_estimate, customer_ref, status')
            .eq('customer_id', customer_id)
            .eq('financial_year', financial_year)
            .in('status', ['approved', 'billed'])
            .order('variation_number')
        : Promise.resolve({ data: [], error: null }),
    ])

    if (customerRes.error || !customerRes.data) {
      return { success: false as const, error: 'Customer not found.' }
    }
    if (scopeRes.error) {
      return { success: false as const, error: scopeRes.error.message }
    }

    type ScopeRow = {
      scope_item: string
      is_included: boolean
      notes: string | null
      sites: { name: string } | { name: string }[] | null
    }
    type VariationRow = {
      variation_number: string
      title: string
      value_approved: number | null
      value_estimate: number | null
      customer_ref: string | null
      status: string
    }
    const scopeRows = (scopeRes.data ?? []) as ScopeRow[]
    const variationRows = (variationsRes?.data ?? []) as VariationRow[]

    const customer = customerRes.data
    const includedItems = scopeRows
      .filter(r => r.is_included)
      .map(r => ({
        scope_item: r.scope_item,
        site_name: Array.isArray(r.sites) ? (r.sites[0]?.name ?? null) : (r.sites?.name ?? null),
        notes: r.notes,
      }))
    const excludedItems = scopeRows
      .filter(r => !r.is_included)
      .map(r => ({
        scope_item: r.scope_item,
        site_name: Array.isArray(r.sites) ? (r.sites[0]?.name ?? null) : (r.sites?.name ?? null),
        notes: r.notes,
      }))
    const approvedVariations = include_variations
      ? variationRows.map(v => ({
          variation_number: v.variation_number,
          title: v.title,
          value: v.value_approved ?? v.value_estimate ?? null,
          customer_ref: v.customer_ref,
        }))
      : undefined

    // Build the docx.
    const docxBuffer = await generateCustomerScopeStatement({
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
        reportType: 'customer_scope_statement',
        reportDate: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
        customerName: customer.name,
        siteName: null,
        siteAddress: null,
        customerLogoUrl: customer.logo_url ?? null,
        sitePhotoUrl: null,
      },
      financialYear: financial_year,
      financialYearDisplay: fyLabel(financial_year),
      includedItems,
      excludedItems,
      approvedVariations,
      introOverride: intro_override,
    })

    let outputBuffer: Buffer = docxBuffer
    let outputFilename = `${customer.name.replace(/[^\w-]+/g, '-')}-Scope-Statement-${financial_year}.docx`
    let outputContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (format === 'pdf') {
      const pdfBuffer = await convertDocxToPdf(docxBuffer)
      if (pdfBuffer) {
        outputBuffer = pdfBuffer
        outputFilename = outputFilename.replace(/\.docx$/, '.pdf')
        outputContentType = 'application/pdf'
      }
      // If conversion backend isn't configured the action returns the
      // docx anyway so the operator gets *something* — surfaced via the
      // returned content type so the UI can mention "PDF backend not
      // configured; downloaded as DOCX".
    }

    await logAuditEvent({
      action: 'export',
      entityType: 'contract_scope',
      summary: `Generated scope statement for ${customer.name} (${fyLabel(financial_year)})`,
      metadata: {
        customer_id,
        financial_year,
        format,
        included_count: includedItems.length,
        excluded_count: excludedItems.length,
        variation_count: approvedVariations?.length ?? null,
      },
    })

    return {
      success: true as const,
      filename: outputFilename,
      content_type: outputContentType,
      // Base64 so the result survives the JSON round-trip through Next's
      // server action protocol.
      data_b64: outputBuffer.toString('base64'),
    }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}

export type ScopeStatementResult =
  | { success: true; filename: string; content_type: string; data_b64: string }
  | { success: false; error: string }
