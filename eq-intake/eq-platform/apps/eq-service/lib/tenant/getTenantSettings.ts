import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TenantSettings } from '@/lib/types'

const DEFAULTS: TenantSettings = {
  id: '',
  tenant_id: '',
  primary_colour: '#3DA8D8',
  deep_colour: '#2986B4',
  ice_colour: '#EAF5FB',
  ink_colour: '#1A1A2E',
  logo_url: null,
  logo_url_on_dark: null,
  product_name: 'EQ Solves',
  support_email: null,
  // Report template defaults
  // (report_site_photos / report_show_site_overview / report_customer_logo
  //  removed 26-Apr-2026 — see audit items 6-8. Site overview and customer
  //  logo are now always-on; site photos toggle was dead.)
  report_show_cover_page: true,
  report_show_contents: true,
  report_show_executive_summary: true,
  report_show_sign_off: true,
  report_header_text: null,
  report_footer_text: null,
  report_company_name: null,
  report_company_address: null,
  report_company_abn: null,
  report_company_phone: null,
  report_sign_off_fields: ['Technician Signature', 'Supervisor Signature'],
  report_logo_url: null,
  report_logo_url_on_dark: null,
  report_complexity: 'standard',
  commercial_features_enabled: false,
  // Module toggles (migration 0097). Defaults here match the migration's
  // post-flip column defaults — false. Real tenant rows are populated by
  // the migration backfill (existing) or the column default (new).
  calendar_enabled: false,
  defects_enabled: false,
  analytics_enabled: false,
  contract_scope_enabled: false,
  updated_at: '',
}

/**
 * Cache-friendly tag for a tenant's settings row. Settings update actions
 * MUST call `revalidateTag(tenantSettingsTag(tenantId))` after a successful
 * write so the next read picks up the new values. Centralised here so a
 * typo doesn't silently break invalidation.
 */
export function tenantSettingsTag(tenantId: string): string {
  return `tenant-settings:${tenantId}`
}

/**
 * Internal: read a tenant_settings row by tenant_id using the service-role
 * admin client (bypasses RLS). Used by the cached wrapper below.
 *
 * Security model: the auth/membership check happens in `getTenantSettings()`
 * BEFORE this is called, so by the time we hit the cache the caller has
 * already proved they belong to `tenantId`. The admin client is necessary
 * because `unstable_cache` does not allow access to `cookies()` / `headers()`
 * inside the cache scope (per next/dist/docs/.../unstable_cache.md), and the
 * cookie-bound server client cannot work without that context.
 */
async function _fetchTenantSettingsRow(tenantId: string): Promise<TenantSettings | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as TenantSettings | null) ?? null
}

/**
 * Read tenant settings for a known tenant ID, memoised across requests via
 * `unstable_cache`. The cache is keyed on `tenantId` and tagged
 * `tenant-settings:<tenantId>` so the admin settings + report-settings
 * update actions can invalidate selectively via `revalidateTag`.
 *
 * `revalidate: 3600` is a belt-and-braces fallback — if a write somewhere
 * forgets to call `revalidateTag`, the cache TTLs after an hour. Settings
 * change weekly at most, so a hot dashboard / report / cron tick can serve
 * dozens of requests from the cache without a Supabase round-trip.
 */
export async function getCachedTenantSettings(tenantId: string): Promise<TenantSettings | null> {
  const cached = unstable_cache(
    () => _fetchTenantSettingsRow(tenantId),
    ['tenant_settings', tenantId],
    { tags: [tenantSettingsTag(tenantId)], revalidate: 3600 },
  )
  return cached()
}

/**
 * Fetches the tenant settings for the current authenticated user. Falls back
 * to EQ defaults if no tenant membership or no settings row exists.
 *
 * The auth + membership lookup is per-request (uncached, depends on cookies).
 * The tenant_settings row itself is read through the cached helper above.
 */
export async function getTenantSettings(): Promise<{
  settings: TenantSettings
  tenantId: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { settings: DEFAULTS, tenantId: null }

  // Get user's tenant membership
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) return { settings: DEFAULTS, tenantId: null }

  const settings = await getCachedTenantSettings(membership.tenant_id)
  return {
    settings: settings ?? { ...DEFAULTS, tenant_id: membership.tenant_id },
    tenantId: membership.tenant_id,
  }
}
