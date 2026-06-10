'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { tenantSettingsTag } from '@/lib/tenant/getTenantSettings'

/**
 * Report settings update payload.
 *
 * Three settings were dropped 26-Apr-2026 (audit items 6-8):
 *   - report_site_photos          → dead, no generator read it
 *   - report_show_site_overview   → only pm-asset-report read it; baked to true
 *   - report_customer_logo        → only the maintenance Send-Report path read it; baked to true
 *
 * Migration 0065 drops the columns. The form no longer surfaces these toggles.
 */
interface ReportSettingsUpdate {
  report_show_cover_page: boolean
  report_show_contents: boolean
  report_show_executive_summary: boolean
  report_show_sign_off: boolean
  report_header_text: string | null
  report_footer_text: string | null
  report_company_name: string | null
  report_company_address: string | null
  report_company_abn: string | null
  report_company_phone: string | null
  report_sign_off_fields: string[]
  report_logo_url: string | null
  report_logo_url_on_dark: string | null
  report_complexity: 'summary' | 'standard' | 'detailed'
}

export async function updateReportSettingsAction(data: ReportSettingsUpdate) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    // Validate sign-off fields
    if (!Array.isArray(data.report_sign_off_fields) || data.report_sign_off_fields.length === 0) {
      return { success: false, error: 'At least one sign-off field is required.' }
    }

    // Trim text fields
    const update = {
      report_show_cover_page: data.report_show_cover_page,
      report_show_contents: data.report_show_contents,
      report_show_executive_summary: data.report_show_executive_summary,
      report_show_sign_off: data.report_show_sign_off,
      report_header_text: data.report_header_text?.trim() || null,
      report_footer_text: data.report_footer_text?.trim() || null,
      report_company_name: data.report_company_name?.trim() || null,
      report_company_address: data.report_company_address?.trim() || null,
      report_company_abn: data.report_company_abn?.trim() || null,
      report_company_phone: data.report_company_phone?.trim() || null,
      report_sign_off_fields: data.report_sign_off_fields.filter(f => f.trim().length > 0),
      report_logo_url: data.report_logo_url?.trim() || null,
      report_logo_url_on_dark: data.report_logo_url_on_dark?.trim() || null,
      report_complexity: data.report_complexity ?? 'standard',
    }

    const { error } = await supabase
      .from('tenant_settings')
      .update(update)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'tenant_settings', summary: 'Updated report settings' })
    // Bust the unstable_cache-backed tenant_settings read so the next report
    // render picks up the new template settings. updateTag is the Next 16
    // server-action-scoped form of revalidateTag (read-your-own-writes
    // semantics). revalidatePath stays as a belt-and-braces fallback.
    updateTag(tenantSettingsTag(tenantId))
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
