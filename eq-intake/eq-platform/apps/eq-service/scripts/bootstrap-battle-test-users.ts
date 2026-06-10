/**
 * bootstrap-battle-test-users.ts — `npx tsx scripts/bootstrap-battle-test-users.ts`
 *
 * One-shot, idempotent provisioning of the two test users the overnight
 * battle-test agent signs in as. Captures the "service-role mint" answer
 * to Q4 from the 2026-05-13 triage:
 *
 *   - Agent has SUPABASE_SERVICE_ROLE_KEY in its env
 *   - Agent uses supabase.auth.admin.generateLink() per run to mint a
 *     one-time magic link for a known UUID
 *   - No stored passwords; the .env.local only needs UUIDs + emails
 *
 * This script seeds the two users (admin + portal) and wires them into
 * the demo tenant so generateLink() resolves to a working session.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent — re-running is safe. Will:
 *   - Use the existing auth user if email already exists
 *   - Skip tenant_members / customer_contact / report_deliveries inserts
 *     where the row already exists
 *
 * Outputs the two UUIDs at the end so you can paste them into .env.local.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const DEMO_TENANT = 'a0000000-0000-0000-0000-000000000001'

// Stable test identities. Emails are eq.solutions sub-addresses so they
// resolve to Royce's inbox if Supabase ever sends them mail. The agent
// uses admin.generateLink() to mint sessions — these accounts never
// receive an actual email in normal use.
const ADMIN_EMAIL = 'battle-test-admin@eq.solutions'
const ADMIN_NAME = 'Battle Test Admin'
const PORTAL_EMAIL = 'battle-test-portal@eq.solutions'
const PORTAL_CONTACT_NAME = 'Battle Test Portal Contact'

interface UserResolution {
  id: string
  created: boolean
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  fullName: string,
): Promise<UserResolution> {
  // listUsers paginates — for two known emails one page is fine.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw new Error(`listUsers: ${listErr.message}`)
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (existing) return { id: existing.id, created: false }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createErr || !created?.user) {
    throw new Error(`createUser ${email}: ${createErr?.message ?? 'no user returned'}`)
  }
  return { id: created.user.id, created: true }
}

async function ensureAdminMembership(admin: SupabaseClient, userId: string) {
  // Upsert avoids the "already exists" branch.
  const { error } = await admin
    .from('tenant_members')
    .upsert(
      {
        tenant_id: DEMO_TENANT,
        user_id: userId,
        role: 'super_admin',
        is_active: true,
      },
      { onConflict: 'tenant_id,user_id' },
    )
  if (error) throw new Error(`tenant_members upsert: ${error.message}`)
}

async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  email: string,
  fullName: string,
) {
  // The handle_new_user trigger should have created the row on auth user
  // creation — but if a re-run finds a half-state, upsert ensures
  // full_name / email line up.
  const { error } = await admin
    .from('profiles')
    .upsert(
      { id: userId, email, full_name: fullName, is_active: true },
      { onConflict: 'id' },
    )
  if (error) throw new Error(`profiles upsert ${email}: ${error.message}`)
}

interface PortalWiringIds {
  customerId: string
  contactId: string
}

async function ensurePortalWiring(
  admin: SupabaseClient,
): Promise<PortalWiringIds> {
  // Pick the first active customer on the demo tenant — Harborview in
  // the canonical seed. Customer-contacts is keyed on (customer_id, email)
  // so the upsert is safe.
  const { data: customers, error: cErr } = await admin
    .from('customers')
    .select('id, name')
    .eq('tenant_id', DEMO_TENANT)
    .eq('is_active', true)
    .order('name')
    .limit(1)
  if (cErr || !customers || customers.length === 0) {
    throw new Error(`no active customer on demo tenant — cannot wire portal contact (${cErr?.message ?? 'empty result'})`)
  }
  const customerId = customers[0].id as string

  // Idempotent insert of the customer_contact.
  const { data: existingContact } = await admin
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', customerId)
    .ilike('email', PORTAL_EMAIL)
    .maybeSingle()

  let contactId: string
  if (existingContact?.id) {
    contactId = existingContact.id as string
  } else {
    const { data: inserted, error: insErr } = await admin
      .from('customer_contacts')
      .insert({
        tenant_id: DEMO_TENANT,
        customer_id: customerId,
        name: PORTAL_CONTACT_NAME,
        email: PORTAL_EMAIL,
      })
      .select('id')
      .single()
    if (insErr || !inserted) throw new Error(`customer_contacts insert: ${insErr?.message ?? 'no row'}`)
    contactId = inserted.id as string
  }

  // NOTE on portal magic-link gating:
  //
  // The /api/portal/magic-link endpoint only mints a token if the email
  // appears in at least one report_deliveries.delivered_to row. Seeding
  // such a row from scratch requires a lot of NOT NULL fields
  // (maintenance_check_id, content_hash_sha256, signed_url_expires_at,
  // delivered_by, etc.) that aren't worth fabricating just for a test.
  //
  // The battle-test agent doesn't go through that endpoint anyway — it
  // mints sessions via `supabase.auth.admin.generateLink({ type:
  // 'magiclink', email: BATTLE_TEST_PORTAL_EMAIL })`, which bypasses the
  // /api/portal/magic-link gate. The seeded auth user + customer_contact
  // are sufficient.
  //
  // If you DO want to exercise the customer-facing magic-link form via
  // the portal user, generate a real report delivery (e.g. via the
  // Customer Report button on /maintenance/[id]) targeting the portal
  // email after running this script.

  return { customerId, contactId }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  console.log('Bootstrapping battle-test users on demo tenant', DEMO_TENANT)

  const adminUser = await ensureAuthUser(admin, ADMIN_EMAIL, ADMIN_NAME)
  console.log(`  ${adminUser.created ? '✓ created' : '· exists '} auth user: ${ADMIN_EMAIL} → ${adminUser.id}`)
  await ensureProfile(admin, adminUser.id, ADMIN_EMAIL, ADMIN_NAME)
  await ensureAdminMembership(admin, adminUser.id)
  console.log(`  ✓ tenant_members: super_admin on demo`)

  const portalUser = await ensureAuthUser(admin, PORTAL_EMAIL, PORTAL_CONTACT_NAME)
  console.log(`  ${portalUser.created ? '✓ created' : '· exists '} auth user: ${PORTAL_EMAIL} → ${portalUser.id}`)
  await ensureProfile(admin, portalUser.id, PORTAL_EMAIL, PORTAL_CONTACT_NAME)
  const portalWiring = await ensurePortalWiring(admin)
  console.log(`  ✓ customer_contact ${portalWiring.contactId} wired to customer ${portalWiring.customerId}`)

  console.log('\nPaste into .env.local:')
  console.log(`BATTLE_TEST_ADMIN_EMAIL=${ADMIN_EMAIL}`)
  console.log(`BATTLE_TEST_ADMIN_UUID=${adminUser.id}`)
  console.log(`BATTLE_TEST_PORTAL_EMAIL=${PORTAL_EMAIL}`)
  console.log(`BATTLE_TEST_PORTAL_UUID=${portalUser.id}`)
  console.log(`BATTLE_TEST_PORTAL_CUSTOMER_ID=${portalWiring.customerId}`)
  console.log(`BATTLE_TEST_PORTAL_CONTACT_ID=${portalWiring.contactId}`)
}

main().catch((err) => {
  console.error('bootstrap-battle-test-users failed:', err)
  process.exit(1)
})
