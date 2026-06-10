'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath, updateTag } from 'next/cache'
import { tenantSettingsTag } from '@/lib/tenant/getTenantSettings'

/**
 * Step 1: Update tenant company details
 */
export async function updateCompanyDetailsAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) return { success: false, error: 'No tenant membership' }

  const companyName = formData.get('company_name')?.toString().trim()
  const companyAddress = formData.get('company_address')?.toString().trim() || null
  const companyAbn = formData.get('company_abn')?.toString().trim() || null
  const companyPhone = formData.get('company_phone')?.toString().trim() || null
  const supportEmail = formData.get('support_email')?.toString().trim() || null

  if (!companyName) return { success: false, error: 'Company name is required' }

  // Update tenant name
  await supabase
    .from('tenants')
    .update({ name: companyName })
    .eq('id', membership.tenant_id)

  // Upsert tenant settings with company details
  const { error } = await supabase
    .from('tenant_settings')
    .upsert({
      tenant_id: membership.tenant_id,
      report_company_name: companyName,
      report_company_address: companyAddress,
      report_company_abn: companyAbn,
      report_company_phone: companyPhone,
      support_email: supportEmail,
    }, { onConflict: 'tenant_id' })

  if (error) return { success: false, error: error.message }

  // Update user's full name if provided
  const fullName = formData.get('full_name')?.toString().trim()
  if (fullName) {
    await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user.id)
  }

  // Bust the unstable_cache-backed tenant_settings read so the next render
  // picks up the new company details. updateTag is the server-action form.
  updateTag(tenantSettingsTag(membership.tenant_id))
  revalidatePath('/', 'layout')
  return { success: true }
}

/**
 * Step 2: Create first site
 */
export async function createFirstSiteAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) return { success: false, error: 'No tenant membership' }

  const name = formData.get('site_name')?.toString().trim()
  const city = formData.get('city')?.toString().trim() || null
  const state = formData.get('state')?.toString().trim() || null

  if (!name) return { success: false, error: 'Site name is required' }

  // Auto-create customer if name provided
  let customerId: string | null = null
  const customerName = formData.get('customer_name')?.toString().trim()
  if (customerName) {
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', membership.tenant_id)
      .ilike('name', customerName)
      .limit(1)
      .maybeSingle()

    if (existing) {
      customerId = existing.id
    } else {
      const { data: created } = await supabase
        .from('customers')
        .insert({ tenant_id: membership.tenant_id, name: customerName })
        .select('id')
        .single()
      customerId = created?.id ?? null
    }
  }

  const { error } = await supabase
    .from('sites')
    .insert({
      tenant_id: membership.tenant_id,
      name,
      customer_id: customerId,
      city,
      state,
    })

  if (error) return { success: false, error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

/**
 * Step 3: Complete onboarding — set the flag
 */
export async function completeOnboardingAction() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) return { success: false, error: 'No tenant membership' }

  const { error } = await supabase
    .from('tenants')
    .update({ setup_completed_at: new Date().toISOString() })
    .eq('id', membership.tenant_id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

/**
 * Skip onboarding entirely (mark as completed without doing setup)
 */
export async function skipOnboardingAction() {
  return completeOnboardingAction()
}
