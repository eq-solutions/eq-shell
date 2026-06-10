/**
 * RLS — technician can only update checks they're assigned to.
 *
 * The "Write roles and assigned technicians can update checks" policy
 * (migration 0027) is the rule that keeps Tech A from messing with Tech B's
 * work even inside the same tenant. The USING clause demands either a write
 * role (super_admin / admin / supervisor) OR `assigned_to = auth.uid()`.
 *
 * Three shapes:
 *  1. Technician assigned to the check    → UPDATE lands
 *  2. Technician NOT assigned             → UPDATE matches zero rows
 *                                            (RLS hides the row)
 *  3. Admin in the same tenant            → UPDATE lands regardless of
 *                                            assignment (sanity guard so
 *                                            we know the test set-up isn't
 *                                            blocking the happy path)
 *
 * Regression target: if migration 0027 ever loses the role/assignment guard
 * — e.g. someone drops the OR and leaves only the tenant check — Test 2
 * will start passing the wrong way (the update lands). That's a P0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  seedTenantWithUser,
  addUserToTenant,
  signedInClient,
  adminClient,
  cleanupTenant,
  type SeededTenant,
  type SeededUser,
} from '../helpers/db'

describe('RLS — technician update gating on maintenance_checks', () => {
  let tenant: SeededTenant
  let adminUser: SeededUser
  let techAssigned: SeededUser
  let techOther: SeededUser
  let assignedCheckId: string
  let unassignedCheckId: string

  beforeAll(async () => {
    // Seed tenant with an admin user (used as a control to prove the test
    // setup isn't blocking the happy path).
    tenant = await seedTenantWithUser('tech-update', 'admin')
    adminUser = tenant.user

    techAssigned = await addUserToTenant(tenant, 'technician', 'tech-update-assigned')
    techOther = await addUserToTenant(tenant, 'technician', 'tech-update-other')

    const admin = adminClient()

    // Site + job plan to anchor the checks.
    const { data: customer } = await admin
      .from('customers')
      .insert({ tenant_id: tenant.tenantId, name: 'Cust TU', is_active: true })
      .select('id')
      .single()
    const { data: site } = await admin
      .from('sites')
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: customer!.id,
        name: 'Site TU',
        is_active: true,
      })
      .select('id')
      .single()
    const { data: plan } = await admin
      .from('job_plans')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        name: 'IT Plan TU',
        code: `IT-TU-${Date.now()}`,
        frequency: 'annual',
        is_active: true,
      })
      .select('id')
      .single()

    // Two checks — one assigned to techAssigned, one to techOther.
    const { data: a } = await admin
      .from('maintenance_checks')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        job_plan_id: plan!.id,
        due_date: '2026-12-01',
        status: 'scheduled',
        kind: 'maintenance',
        assigned_to: techAssigned.id,
      })
      .select('id')
      .single()
    assignedCheckId = a!.id

    const { data: o } = await admin
      .from('maintenance_checks')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        job_plan_id: plan!.id,
        due_date: '2026-12-02',
        status: 'scheduled',
        kind: 'maintenance',
        assigned_to: techOther.id,
      })
      .select('id')
      .single()
    unassignedCheckId = o!.id
  })

  afterAll(async () => {
    if (tenant) await cleanupTenant(tenant)
  })

  it('Technician CAN update a check assigned to them', async () => {
    const client = await signedInClient(techAssigned.email, techAssigned.password)
    const { error } = await client
      .from('maintenance_checks')
      .update({ notes: 'tech-assigned-update' })
      .eq('id', assignedCheckId)

    expect(error).toBeNull()

    const { data } = await adminClient()
      .from('maintenance_checks')
      .select('notes')
      .eq('id', assignedCheckId)
      .single()
    expect(data?.notes).toBe('tech-assigned-update')
  })

  it("Technician CANNOT update a check assigned to someone else (RLS hides the row)", async () => {
    const client = await signedInClient(techAssigned.email, techAssigned.password)
    const { error } = await client
      .from('maintenance_checks')
      .update({ notes: 'pwned-by-other-tech' })
      .eq('id', unassignedCheckId)

    // RLS USING hides the row → update matches zero rows. Postgres reports
    // no error. The leak is silent — we verify by reading via admin.
    expect(error).toBeNull()

    const { data } = await adminClient()
      .from('maintenance_checks')
      .select('notes')
      .eq('id', unassignedCheckId)
      .single()
    expect(data?.notes ?? null).not.toBe('pwned-by-other-tech')
  })

  it("Admin CAN update any check in the tenant regardless of assignment", async () => {
    // Control: confirms the test setup isn't blocking the happy path —
    // an admin in the same tenant can update either check. If THIS fails,
    // the RLS policy is over-tight, not under-tight.
    const client = await signedInClient(adminUser.email, adminUser.password)
    const { error } = await client
      .from('maintenance_checks')
      .update({ notes: 'admin-touched' })
      .eq('id', unassignedCheckId)

    expect(error).toBeNull()

    const { data } = await adminClient()
      .from('maintenance_checks')
      .select('notes')
      .eq('id', unassignedCheckId)
      .single()
    expect(data?.notes).toBe('admin-touched')
  })
})
