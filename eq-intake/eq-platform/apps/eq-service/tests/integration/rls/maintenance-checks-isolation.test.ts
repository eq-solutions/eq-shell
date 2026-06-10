/**
 * RLS — cross-tenant maintenance_checks isolation.
 *
 * Customers is the most load-bearing RLS surface; maintenance_checks is a
 * close second. A check carries notes, signatures, asset IDs, and job-plan
 * context — leaking it across tenants leaks the customer's site map.
 *
 * Covers four attack shapes:
 *  1. SELECT by id  — User B targets a known Tenant A check id
 *  2. LIST          — User B enumerates all checks, must see zero of A's
 *  3. INSERT inject — User B inserts a row with Tenant A's tenant_id
 *  4. UPDATE        — User B targets Tenant A's check by id with their own
 *                     update (RLS USING should hide the row from the update)
 *
 * If any of these surface Tenant A's check to User B, treat as P0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  seedTenantWithAdmin,
  signedInClient,
  adminClient,
  cleanupTenant,
  type SeededTenant,
} from '../helpers/db'

describe('RLS — maintenance_checks cross-tenant isolation', () => {
  let tenantA: SeededTenant
  let tenantB: SeededTenant
  let checkAId: string
  let siteAId: string
  let jobPlanAId: string

  beforeAll(async () => {
    tenantA = await seedTenantWithAdmin('mc-a')
    tenantB = await seedTenantWithAdmin('mc-b')

    const admin = adminClient()

    // Tenant A needs a customer + site + job_plan before we can build a check.
    const { data: customer, error: cErr } = await admin
      .from('customers')
      .insert({ tenant_id: tenantA.tenantId, name: 'Cust A', is_active: true })
      .select('id')
      .single()
    if (cErr || !customer) throw new Error(`seed customer A failed: ${cErr?.message ?? 'no row'}`)

    const { data: site, error: sErr } = await admin
      .from('sites')
      .insert({
        tenant_id: tenantA.tenantId,
        customer_id: customer.id,
        name: 'Site A',
        is_active: true,
      })
      .select('id')
      .single()
    if (sErr || !site) throw new Error(`seed site A failed: ${sErr?.message ?? 'no row'}`)
    siteAId = site.id

    const { data: plan, error: jErr } = await admin
      .from('job_plans')
      .insert({
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        name: 'IT Plan A',
        code: `IT-A-${Date.now()}`,
        frequency: 'annual',
        is_active: true,
      })
      .select('id')
      .single()
    if (jErr || !plan) throw new Error(`seed plan A failed: ${jErr?.message ?? 'no row'}`)
    jobPlanAId = plan.id

    const { data: check, error: kErr } = await admin
      .from('maintenance_checks')
      .insert({
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        job_plan_id: jobPlanAId,
        due_date: '2026-12-01',
        status: 'scheduled',
        kind: 'maintenance',
      })
      .select('id')
      .single()
    if (kErr || !check) throw new Error(`seed check A failed: ${kErr?.message ?? 'no row'}`)
    checkAId = check.id
  })

  afterAll(async () => {
    if (tenantA) await cleanupTenant(tenantA)
    if (tenantB) await cleanupTenant(tenantB)
  })

  it("User B cannot read Tenant A's check by id", async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('maintenance_checks')
      .select('id, tenant_id, notes')
      .eq('id', checkAId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('User B sees zero of Tenant A rows when listing checks', async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('maintenance_checks')
      .select('id, tenant_id')

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    for (const row of data ?? []) {
      expect(row.tenant_id).toBe(tenantB.tenantId)
    }
    expect(data?.find((r) => r.id === checkAId)).toBeUndefined()
  })

  it("User B cannot insert a check carrying Tenant A's tenant_id", async () => {
    // INSERT must pass WITH CHECK against (a) tenant membership and (b) the
    // role-gated writer policy. User B is admin of Tenant B, not Tenant A —
    // so the tenant_id check rejects the row.
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('maintenance_checks')
      .insert({
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        job_plan_id: jobPlanAId,
        due_date: '2026-12-31',
        status: 'scheduled',
        kind: 'maintenance',
      })
      .select('id')
      .maybeSingle()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message?.toLowerCase()).toMatch(/(row-level security|permission denied|policy)/)
  })

  it("User B's UPDATE targeting Tenant A's check id finds zero rows", async () => {
    // RLS USING clauses run on UPDATE too — the row is invisible to User B
    // so the update simply matches nothing. Postgres reports success but no
    // rows are touched. Verify by re-reading via admin and confirming the
    // attacker's payload did NOT land.
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { error } = await clientB
      .from('maintenance_checks')
      .update({ notes: 'pwned-by-tenant-b' })
      .eq('id', checkAId)

    expect(error).toBeNull()

    const admin = adminClient()
    const { data: after } = await admin
      .from('maintenance_checks')
      .select('notes')
      .eq('id', checkAId)
      .single()

    expect(after?.notes ?? null).not.toBe('pwned-by-tenant-b')
  })
})
