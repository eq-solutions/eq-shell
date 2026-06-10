'use server'

import { createClient } from '@/lib/supabase/server'
import { generateCustomerScopeStatement } from '@/lib/reports/customer-scope-statement'

/**
 * Portal-side scope-statement download. Same generator as the admin
 * /contract-scope toolbar Phase 8 button, but auth is the portal magic-
 * link session and customer + tenant come from the get_portal_*
 * helpers (no canWrite check — this is the customer's own data).
 *
 * Returns the docx as base64 (round-trips fine through the server-action
 * protocol). PDF conversion is intentionally not offered from the portal —
 * customers download docx and convert locally if they want PDF.
 */
export async function generatePortalScopeStatementAction(financialYear: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return { success: false as const, error: 'Not signed in.' }

    const [{ data: customerIdRpc }, { data: tenantIdRpc }] = await Promise.all([
      supabase.rpc('get_portal_customer_id'),
      supabase.rpc('get_portal_tenant_id'),
    ])
    const customerId = customerIdRpc as string | null
    const tenantId = tenantIdRpc as string | null
    if (!customerId || !tenantId) {
      return { success: false as const, error: 'No customer record linked to your account.' }
    }

    if (!financialYear?.trim()) {
      return { success: false as const, error: 'Financial year is required.' }
    }

    // Pull tenant settings for branding + commercial-tier gate. The
    // scope statement is a commercial-tier feature; the rest of the
    // portal works on free tier.
    const { data: settingsRow } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!settingsRow?.commercial_features_enabled) {
      return { success: false as const, error: 'Scope statement download is enabled per contract — please contact your account manager.' }
    }

    const [customerRes, scopeRes, variationsRes] = await Promise.all([
      supabase.from('customers').select('id, name, logo_url').eq('id', customerId).maybeSingle(),
      supabase
        .from('contract_scopes')
        .select('scope_item, is_included, notes, sites(name)')
        .eq('customer_id', customerId)
        .eq('financial_year', financialYear)
        .order('is_included', { ascending: false })
        .order('scope_item'),
      supabase
        .from('contract_variations')
        .select('variation_number, title, value_approved, value_estimate, customer_ref, status')
        .eq('customer_id', customerId)
        .eq('financial_year', financialYear)
        .in('status', ['approved', 'billed'])
        .order('variation_number'),
    ])
    if (!customerRes.data) return { success: false as const, error: 'Customer not found.' }
    const customer = customerRes.data

    type ScopeRow = {
      scope_item: string; is_included: boolean; notes: string | null
      sites: { name: string } | { name: string }[] | null
    }
    type VariationRow = {
      variation_number: string; title: string
      value_approved: number | null; value_estimate: number | null
      customer_ref: string | null; status: string
    }
    const scopeRows = (scopeRes.data ?? []) as ScopeRow[]
    const variationRows = (variationsRes.data ?? []) as VariationRow[]

    const fyDisplay = /^\d{4}$/.test(financialYear) ? `CY ${financialYear}` : `FY ${financialYear}`

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
      financialYear,
      financialYearDisplay: fyDisplay,
      includedItems: scopeRows.filter(r => r.is_included).map(r => ({
        scope_item: r.scope_item,
        site_name: Array.isArray(r.sites) ? (r.sites[0]?.name ?? null) : (r.sites?.name ?? null),
        notes: r.notes,
      })),
      excludedItems: scopeRows.filter(r => !r.is_included).map(r => ({
        scope_item: r.scope_item,
        site_name: Array.isArray(r.sites) ? (r.sites[0]?.name ?? null) : (r.sites?.name ?? null),
        notes: r.notes,
      })),
      approvedVariations: variationRows.map(v => ({
        variation_number: v.variation_number,
        title: v.title,
        value: v.value_approved ?? v.value_estimate ?? null,
        customer_ref: v.customer_ref,
      })),
      introOverride: null,
    })

    const filename = `${customer.name.replace(/[^\w-]+/g, '-')}-Scope-Statement-${financialYear}.docx`
    return {
      success: true as const,
      filename,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data_b64: docxBuffer.toString('base64'),
    }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}
