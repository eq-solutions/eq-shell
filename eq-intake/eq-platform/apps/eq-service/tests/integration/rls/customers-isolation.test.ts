/**
 * RLS — cross-tenant customer isolation.
 *
 * The single most load-bearing invariant in this app: a user in Tenant A
 * MUST NOT see Tenant B's data. The `customers` table holds names, contact
 * info, and is FK-referenced by sites / contract_scopes / variations — a
 * leak here cascades. The boundary is enforced entirely by the RLS policy
 * on `customers` using `get_user_tenant_ids()` (migration 0027). This test
 * exercises that policy with two real signed-in users in two real tenants.
 *
 * If this test ever fails, treat as a P0 — flag the RLS policy on customers
 * immediately and check for similar drift on any table touched in the same
 * migration window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  seedTenantWithAdmin,
  signedInClient,
  adminClient,
  cleanupTenant,
  type SeededTenant,
} from '../helpers/db'

describe('RLS — customers cross-tenant isolation', () => {
  let tenantA: SeededTenant
  let tenantB: SeededTenant
  let customerAId: string

  beforeAll(async () => {
    tenantA = await seedTenantWithAdmin('a')
    tenantB = await seedTenantWithAdmin('b')

    // Seed one customer in Tenant A via the admin client (service_role
    // bypasses RLS). This is the row that User B should not be able to
    // see — the whole point of the test.
    const admin = adminClient()
    const { data, error } = await admin
      .from('customers')
      .insert({
        tenant_id: tenantA.tenantId,
        name: 'Tenant-A Customer',
        is_active: true,
      })
      .select('id')
      .single()

    if (error || !data) throw new Error(`seed customer failed: ${error?.message ?? 'no row'}`)
    customerAId = data.id
  })

  afterAll(async () => {
    if (tenantA) await cleanupTenant(tenantA)
    if (tenantB) await cleanupTenant(tenantB)
  })

  it('User A (Tenant A) sees their own customer', async () => {
    const clientA = await signedInClient(tenantA.user.email, tenantA.user.password)
    const { data, error } = await clientA
      .from('customers')
      .select('id, name, tenant_id')
      .eq('id', customerAId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data?.id).toBe(customerAId)
    expect(data?.tenant_id).toBe(tenantA.tenantId)
  })

  it('User B (Tenant B) CANNOT read Tenant A\'s customer by id', async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('customers')
      .select('id, name')
      .eq('id', customerAId)
      .maybeSingle()

    // RLS hides the row entirely — Postgres returns no rows, not an error.
    // (If this returns the row, the RLS policy is broken and we have a leak.)
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('User B (Tenant B) sees zero rows when listing all customers', async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('customers')
      .select('id, tenant_id')

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    // Every row visible to User B must belong to Tenant B. Tenant A's
    // customer must NOT appear.
    for (const row of data ?? []) {
      expect(row.tenant_id).toBe(tenantB.tenantId)
    }
    expect(data?.find((r) => r.id === customerAId)).toBeUndefined()
  })

  it('User B cannot write a customer into Tenant A even with the tenant_id supplied', async () => {
    // Authorization attack: User B tries to inject a row carrying Tenant A's
    // tenant_id. RLS WITH CHECK must reject this — `tenant_id` on insert is
    // validated against `get_user_tenant_ids()` which only returns User B's
    // tenant. If this succeeds, the RLS WITH CHECK clause is broken.
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('customers')
      .insert({
        tenant_id: tenantA.tenantId,
        name: 'Injected by User B',
        is_active: true,
      })
      .select('id')
      .maybeSingle()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    // Postgres surfaces RLS rejection as code 42501 (insufficient_privilege)
    // or a "new row violates row-level security policy" message. Don't
    // pin to exact text — pin to the fact that an error happened.
    expect(error?.message?.toLowerCase()).toMatch(/(row-level security|permission denied|policy)/)
  })
})
