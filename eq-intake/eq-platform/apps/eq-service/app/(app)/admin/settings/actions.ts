'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { tenantSettingsTag } from '@/lib/tenant/getTenantSettings'
import { z } from 'zod'

const UpdateTenantSettingsSchema = z.object({
  product_name: z.string().min(1, 'Product name is required').max(100),
  primary_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  deep_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  ice_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  ink_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  logo_url: z.string().max(500).nullable().optional(),
  logo_url_on_dark: z.string().max(500).nullable().optional(),
  support_email: z.string().email().nullable().optional(),
  commercial_features_enabled: z.boolean(),
  // Module toggles — see migration 0097.
  calendar_enabled: z.boolean(),
  defects_enabled: z.boolean(),
  analytics_enabled: z.boolean(),
  contract_scope_enabled: z.boolean(),
})

// uploadLogoAction was removed — logos are now uploaded via Admin → Media
// Library and referenced here via the MediaPicker component. Single source
// of truth: the `media_library` table. This action just accepts a URL.

export async function updateTenantSettingsAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      product_name: formData.get('product_name'),
      primary_colour: formData.get('primary_colour'),
      deep_colour: formData.get('deep_colour'),
      ice_colour: formData.get('ice_colour'),
      ink_colour: formData.get('ink_colour'),
      logo_url: formData.get('logo_url') || null,
      logo_url_on_dark: formData.get('logo_url_on_dark') || null,
      support_email: formData.get('support_email') || null,
      // Checkbox sends 'on' when checked, nothing when unchecked.
      commercial_features_enabled: formData.get('commercial_features_enabled') === 'on',
      calendar_enabled:            formData.get('calendar_enabled') === 'on',
      defects_enabled:             formData.get('defects_enabled') === 'on',
      analytics_enabled:           formData.get('analytics_enabled') === 'on',
      contract_scope_enabled:      formData.get('contract_scope_enabled') === 'on',
    }

    const parsed = UpdateTenantSettingsSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('tenant_settings')
      .update(parsed.data)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'tenant_settings', summary: 'Updated tenant settings' })
    // Bust the unstable_cache-backed tenant_settings read in
    // lib/tenant/getTenantSettings so the next dashboard / report / cron
    // tick picks up the new values immediately. updateTag is the Next 16
    // server-action-scoped form of revalidateTag — it enables read-your-
    // own-writes semantics, which matches "user clicks Save → next page
    // load sees the new colour." revalidatePath stays as a belt-and-
    // braces fallback for any route doing a direct Supabase read.
    updateTag(tenantSettingsTag(tenantId))
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
