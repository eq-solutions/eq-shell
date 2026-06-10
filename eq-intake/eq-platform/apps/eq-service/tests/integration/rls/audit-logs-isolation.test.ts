/**
 * RLS — audit_logs cross-tenant isolation.
 *
 * Audit logs are immutable (no UPDATE/DELETE policies) but their READ side
 * is highly leak-sensitive: `summary` and `metadata` can carry entity
 * names, role changes, customer references, IP addresses, and other
 * incident-investigation context. A reader leak across tenants is a
 * compliance problem before it's a security problem.
 *
 * Three shapes:
 *  1. User B SELECT by id  → Tenant A's audit row is invisible
 *  2. User B LIST          → returns only Tenant B rows
 *  3. User B INSERT inject → cannot write a row with Tenant A's tenant_id
 *
 * audit_logs has no UPDATE or DELETE policies (migration 0008 line 27 —
 * "audit logs are immutable"), so we don't exercise those paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  seedTenantWithAdmin,
  signedInClient,
  adminClient,
  cleanupTenant,
  type SeededTenant,
} from '../helpers/db'

describe('RLS — audit_logs cross-tenant isolation', () => {
  let tenantA: SeededTenant
  let tenantB: SeededTenant
  let auditAId: string

  beforeAll(async () => {
    tenantA = await seedTenantWithAdmin('al-a')
    tenantB = await seedTenantWithAdmin('al-b')

    const admin = adminClient()
    const { data, error } = await admin
      .from('audit_logs')
      .insert({
        tenant_id: tenantA.tenantId,
        user_id: tenantA.user.id,
        action: 'create',
        entity_type: 'maintenance_check',
        entity_id: null,
        summary: 'sensitive: Tenant A internal entry',
        metadata: { ip: '10.0.0.1', secret_note: 'tenantA-only' },
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed audit failed: ${error?.message ?? 'no row'}`)
    auditAId = data.id
  })

  afterAll(async () => {
    if (tenantA) await cleanupTenant(tenantA)
    if (tenantB) await cleanupTenant(tenantB)
  })

  it("User B CANNOT read Tenant A's audit log by id", async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('audit_logs')
      .select('id, summary, metadata')
      .eq('id', auditAId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('User B sees zero of Tenant A rows when listing audit logs', async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('audit_logs')
      .select('id, tenant_id, summary')

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    for (const row of data ?? []) {
      expect(row.tenant_id).toBe(tenantB.tenantId)
    }
    expect(data?.find((r) => r.id === auditAId)).toBeUndefined()
  })

  it("User B cannot insert an audit_log carrying Tenant A's tenant_id", async () => {
    // Authorization attack: User B fabricates an audit entry into Tenant A.
    // WITH CHECK on audit_logs_insert ties tenant_id to the caller's
    // get_user_tenant_ids() — User B only owns Tenant B, so the row is
    // rejected. If THIS succeeds, an attacker can forge audit trails.
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const { data, error } = await clientB
      .from('audit_logs')
      .insert({
        tenant_id: tenantA.tenantId,
        user_id: tenantB.user.id,
        action: 'update',
        entity_type: 'tenant_settings',
        entity_id: null,
        summary: 'forged audit entry — should be blocked',
        metadata: { forged: true },
      })
      .select('id')
      .maybeSingle()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.message?.toLowerCase()).toMatch(/(row-level security|permission denied|policy)/)
  })
})
