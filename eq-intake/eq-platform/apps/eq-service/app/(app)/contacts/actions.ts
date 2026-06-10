'use server'

/**
 * Contacts — bulk CSV import.
 *
 * Sprint 4.1 (2026-04-26).
 *
 * Schema: contacts are stored in two separate tables (customer_contacts +
 * site_contacts). The import action does a name-based lookup to figure out
 * which table to insert into:
 *
 *   - Site filled in?  → look up the site within the named customer →
 *                        insert into site_contacts (linked to the site).
 *   - Site blank?      → look up the customer → insert into customer_contacts.
 *   - Customer not found → row error, skip.
 *   - Site provided but not found within customer → row error, skip.
 *
 * Match is case-insensitive on the customer/site name. Multiple sites with
 * the same name across customers are disambiguated by the customer name.
 *
 * Returns a per-row error list so the import modal can show what failed.
 */

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite } from '@/lib/utils/roles'

export interface ContactImportRow {
  customer: string
  site: string | null
  name: string
  email: string | null
  phone: string | null
  role: string | null
}

export async function importContactsAction(rows: ContactImportRow[]) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }
    }

    if (rows.length === 0) {
      return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] }
    }
    if (rows.length > 1000) {
      return { success: false, error: 'Maximum 1,000 rows per import.', imported: 0, rowErrors: [] }
    }

    const rowErrors: string[] = []

    // ── 1. Pre-fetch lookup maps (customers + sites) so we don't hammer the
    //     DB once per row. RLS scopes both queries to the current tenant.
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name')
      .eq('is_active', true)

    const customerByName = new Map<string, string>()
    for (const c of customers ?? []) {
      customerByName.set(c.name.toLowerCase().trim(), c.id as string)
    }

    const { data: sites } = await supabase
      .from('sites')
      .select('id, name, customer_id')
      .eq('is_active', true)

    // Sites can share names across customers, so the key is `customerId::siteName`.
    const siteByCustomerAndName = new Map<string, string>()
    for (const s of sites ?? []) {
      const key = `${s.customer_id}::${(s.name as string).toLowerCase().trim()}`
      siteByCustomerAndName.set(key, s.id as string)
    }

    // ── 2. Bucket rows into the two destination tables.
    const customerInserts: Array<{
      tenant_id: string
      customer_id: string
      name: string
      email: string | null
      phone: string | null
      role: string | null
    }> = []
    const siteInserts: Array<{
      tenant_id: string
      site_id: string
      name: string
      email: string | null
      phone: string | null
      role: string | null
    }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // +2 = 1-based + header row in source CSV

      const customerName = row.customer?.trim()
      if (!customerName) {
        rowErrors.push(`Row ${rowNum}: Customer is required.`)
        continue
      }
      if (!row.name?.trim()) {
        rowErrors.push(`Row ${rowNum}: Name is required.`)
        continue
      }

      const customerId = customerByName.get(customerName.toLowerCase())
      if (!customerId) {
        rowErrors.push(`Row ${rowNum}: Customer "${customerName}" not found.`)
        continue
      }

      const siteName = row.site?.trim()
      if (siteName) {
        const siteId = siteByCustomerAndName.get(`${customerId}::${siteName.toLowerCase()}`)
        if (!siteId) {
          rowErrors.push(`Row ${rowNum}: Site "${siteName}" not found under customer "${customerName}".`)
          continue
        }
        siteInserts.push({
          tenant_id: tenantId,
          site_id: siteId,
          name: row.name.trim(),
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          role: row.role?.trim() || null,
        })
      } else {
        customerInserts.push({
          tenant_id: tenantId,
          customer_id: customerId,
          name: row.name.trim(),
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          role: row.role?.trim() || null,
        })
      }
    }

    // ── 3. Insert in two batches.
    let inserted = 0
    if (customerInserts.length > 0) {
      const { error } = await supabase.from('customer_contacts').insert(customerInserts)
      if (error) {
        return { success: false, error: `Customer contacts insert failed: ${error.message}`, imported: 0, rowErrors }
      }
      inserted += customerInserts.length
    }
    if (siteInserts.length > 0) {
      const { error } = await supabase.from('site_contacts').insert(siteInserts)
      if (error) {
        return {
          success: false,
          error: `Site contacts insert failed (customer contacts already inserted): ${error.message}`,
          imported: customerInserts.length,
          rowErrors,
        }
      }
      inserted += siteInserts.length
    }

    if (inserted > 0) {
      await logAuditEvent({
        action: 'create',
        entityType: 'contact',
        summary: `Imported ${inserted} contacts from CSV (${customerInserts.length} customer, ${siteInserts.length} site)`,
      })
    }

    revalidatePath('/contacts')
    revalidatePath('/customers')
    revalidatePath('/sites')

    return {
      success: inserted > 0,
      imported: inserted,
      rowErrors,
      error: inserted === 0 ? 'No rows could be imported — see row errors.' : undefined,
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}
