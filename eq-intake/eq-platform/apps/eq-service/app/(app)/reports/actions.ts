'use server'

import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import { revalidatePath } from 'next/cache'
import {
  generateAndStoreReport,
  generateAndStoreWorkOrderDetailsReport,
} from '@/lib/reports/generate-and-store'
import { sendReportDeliveryEmail } from '@/lib/email/send-report-email'

/**
 * Issue a maintenance check report — generates PDF + DOCX, stores in the
 * attachments bucket, records a report_deliveries row, and (when email is
 * configured) sends signed-URL links to the recipients.
 *
 * This action is the single entry point for the report delivery pipeline.
 * Design: docs/architecture/report-delivery.md
 */
/**
 * Issue a maintenance report.
 *
 * `report_type` (Sprint 2.3 dispatcher restored 26-Apr-2026 — was lost in
 * the prior recovery per memory note `project_phase2_ui_lost_2026_04_26`):
 *   - 'pm_check'   → generatePMCheckReport via generate-and-store. Default.
 *                    Simpler check-level summary with pass/fail per item.
 *   - 'wo_details' → generateWorkOrderDetailsReport. Per-asset Maximo
 *                    parity layout with WO# / tasks / defects per asset.
 */
export async function issueMaintenanceReportAction(data: {
  maintenance_check_id: string
  recipient_emails: string[]
  cc_emails?: string[]
  message?: string
  revision_reason?: string
  mutationId?: string
  report_type?: 'pm_check' | 'wo_details'
}) {
  return withIdempotency(data.mutationId, async () => {
    try {
      const { supabase, tenantId, role, user } = await requireUser()
      if (!canWrite(role) && role !== 'technician') {
        return { success: false, error: 'Insufficient permissions.' }
      }

      if (!data.recipient_emails.length) {
        return { success: false, error: 'At least one recipient email is required.' }
      }

      // Load the maintenance check + site + customer
      const { data: check, error: checkError } = await supabase
        .from('maintenance_checks')
        .select(`
          id, custom_name, status, due_date, completed_at,
          sites(id, name, customer_id, customers(id, name, email))
        `)
        .eq('id', data.maintenance_check_id)
        .single()

      if (checkError || !check) {
        return { success: false, error: 'Maintenance check not found.' }
      }

      const site = Array.isArray(check.sites) ? check.sites[0] : check.sites
      const customer = site ? (Array.isArray((site as Record<string, unknown>).customers) ? ((site as Record<string, unknown>).customers as Record<string, unknown>[])[0] : (site as Record<string, unknown>).customers) : null

      if (!customer || !(customer as Record<string, unknown>).id) {
        return { success: false, error: 'Could not resolve customer for this check.' }
      }

      // Determine revision number
      const { data: existingDeliveries } = await supabase
        .from('report_deliveries')
        .select('revision')
        .eq('maintenance_check_id', data.maintenance_check_id)
        .order('revision', { ascending: false })
        .limit(1)

      const nextRevision = existingDeliveries && existingDeliveries.length > 0
        ? existingDeliveries[0].revision + 1
        : 1

      if (nextRevision > 1 && !data.revision_reason?.trim()) {
        return { success: false, error: 'A revision reason is required when reissuing a report.' }
      }

      // ── Generate DOCX + upload to Storage + compute hash ──
      // Dispatch on report_type — defaults to pm_check for backward compat.
      const reportType = data.report_type ?? 'pm_check'
      const report = reportType === 'wo_details'
        ? await generateAndStoreWorkOrderDetailsReport(
            supabase,
            tenantId,
            data.maintenance_check_id,
            nextRevision,
          )
        : await generateAndStoreReport(
            supabase,
            tenantId,
            data.maintenance_check_id,
            nextRevision,
          )

      // ── Calculate signed URL expiry (30 days) ──
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)

      // ── Generate signed download URL for the DOCX ──
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('attachments')
        .createSignedUrl(report.docxPath, 30 * 24 * 60 * 60) // 30 days in seconds

      if (signedUrlError) {
        console.error('Signed URL generation failed:', signedUrlError.message)
      }

      const docxSignedUrl = signedUrlData?.signedUrl ?? null

      // ── Insert report_deliveries row ──
      const { data: delivery, error: insertError } = await supabase
        .from('report_deliveries')
        .insert({
          tenant_id: tenantId,
          customer_id: (customer as Record<string, unknown>).id as string,
          maintenance_check_id: data.maintenance_check_id,
          revision: nextRevision,
          pdf_file_path: report.pdfPath,
          docx_file_path: report.docxPath,
          content_hash_sha256: report.contentHash,
          delivered_to: data.recipient_emails,
          delivered_by: user.id,
          signed_url_expires_at: expiresAt.toISOString(),
          delivery_message: data.message?.trim() || null,
          revision_reason: data.revision_reason?.trim() || null,
          mutation_id: data.mutationId || null,
        })
        .select('id')
        .single()

      if (insertError) {
        return { success: false, error: insertError.message }
      }

      // ── Send email via Resend ──
      const checkName = check.custom_name ?? (site as Record<string, unknown>)?.name as string ?? 'Maintenance Check'
      const customerName = (customer as Record<string, unknown>).name as string ?? ''

      if (docxSignedUrl) {
        try {
          await sendReportDeliveryEmail({
            to: data.recipient_emails,
            cc: data.cc_emails,
            checkName,
            customerName,
            siteName: (site as Record<string, unknown>)?.name as string ?? '',
            revision: nextRevision,
            revisionReason: data.revision_reason?.trim() || undefined,
            message: data.message?.trim() || undefined,
            docxUrl: docxSignedUrl,
            // pdfUrl: null — will be added when PDF generation is wired
            expiresAt: expiresAt.toISOString(),
            contentHash: report.contentHash,
          })
        } catch (emailErr) {
          // Email failure should not fail the whole action — the report is
          // generated and stored. Log the error and continue.
          console.error('Report delivery email failed:', emailErr)
        }
      }

      await logAuditEvent({
        action: 'create',
        entityType: 'report_delivery',
        entityId: delivery?.id,
        summary: `Issued report for maintenance check (revision ${nextRevision}) to ${data.recipient_emails.join(', ')}`,
      })

      revalidatePath('/reports')
      revalidatePath('/defects')
      return { success: true, revision: nextRevision }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })
}

/**
 * Revoke a report delivery — marks it as revoked so the portal (when built)
 * will not show the download link.
 */
export async function revokeReportDeliveryAction(deliveryId: string, reason: string) {
  try {
    const { supabase, role, user } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }
    if (!reason.trim()) return { success: false, error: 'A revocation reason is required.' }

    const { error } = await supabase
      .from('report_deliveries')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
        revoke_reason: reason.trim(),
      })
      .eq('id', deliveryId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'report_delivery',
      entityId: deliveryId,
      summary: `Revoked report delivery: ${reason}`,
    })

    revalidatePath('/reports')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
