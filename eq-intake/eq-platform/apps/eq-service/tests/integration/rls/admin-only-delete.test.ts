/**
 * RLS — only admin / super_admin can hard-delete a maintenance_check.
 *
 * The app prefers soft-delete (is_active = false) in normal flows, but the
 * DELETE policy on maintenance_checks (migration 0027) is the last-line
 * guard for the rare case where the wire-level DELETE is issued — e.g.
 * cleanup scripts, audit-driven removal. Supervisor + technician + read_only
 * must all bounce.
 *
 * If a supervisor's DELETE ever starts succeeding, the policy regressed and
 * an entire role tier can now wipe checks they were never meant to touch.
 *
 * Note: DELETE through PostgREST with RLS USING-mismatch returns success
 * with zero rows deleted — same pattern as UPDATE. Verify by re-reading
 * via admin.
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

describe('RLS — only admin can DELETE a maintenance_check', () => {
  let tenant: SeededTenant
  let adminUser: SeededUser
  let supervisor: SeededUser
  let supervisorCheckId: string
  let adminCheckId: string

  beforeAll(async () => {
    tenant = await seedTenantWithUser('aod', 'admin')
    adminUser = tenant.user
    supervisor = await addUserToTenant(tenant, 'supervisor', 'aod-sup')

    const admin = adminClient()
    const { data: customer } = await admin
      .from('customers')
      .insert({ tenant_id: tenant.tenantId, name: 'Cust AOD', is_active: true })
      .select('id')
      .single()
    const { data: site } = await admin
      .from('sites')
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: customer!.id,
        name: 'Site AOD',
        is_active: true,
      })
      .select('id')
      .single()
    const { data: plan } = await admin
      .from('job_plans')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        name: 'IT Plan AOD',
        code: `IT-AOD-${Date.now()}`,
        frequency: 'annual',
        is_active: true,
      })
      .select('id')
      .single()

    const { data: a } = await admin
      .from('maintenance_checks')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        job_plan_id: plan!.id,
        due_date: '2026-12-01',
        status: 'scheduled',
        kind: 'maintenance',
      })
      .select('id')
      .single()
    supervisorCheckId = a!.id

    const { data: b } = await admin
      .from('maintenance_checks')
      .insert({
        tenant_id: tenant.tenantId,
        site_id: site!.id,
        job_plan_id: plan!.id,
        due_date: '2026-12-02',
        status: 'scheduled',
        kind: 'maintenance',
      })
      .select('id')
      .single()
    adminCheckId = b!.id
  })

  afterAll(async () => {
    if (tenant) await cleanupTenant(tenant)
  })

  it('Supervisor CANNOT delete a maintenance_check (RLS USING blocks)', async () => {
    const client = await signedInClient(supervisor.email, supervisor.password)
    const { error } = await client
      .from('maintenance_checks')
      .delete()
      .eq('id', supervisorCheckId)

    // RLS USING hides the row from DELETE → 0 rows deleted, no error.
    expect(error).toBeNull()

    const { data, error: readErr } = await adminClient()
      .from('maintenance_checks')
      .select('id')
      .eq('id', supervisorCheckId)
      .maybeSingle()

    expect(readErr).toBeNull()
    expect(data?.id).toBe(supervisorCheckId)
  })

  it('Admin CAN delete a maintenance_check', async () => {
    const client = await signedInClient(adminUser.email, adminUser.password)
    const { error } = await client
      .from('maintenance_checks')
      .delete()
      .eq('id', adminCheckId)

    expect(error).toBeNull()

    const { data } = await adminClient()
      .from('maintenance_checks')
      .select('id')
      .eq('id', adminCheckId)
      .maybeSingle()

    expect(data).toBeNull()
  })
})
