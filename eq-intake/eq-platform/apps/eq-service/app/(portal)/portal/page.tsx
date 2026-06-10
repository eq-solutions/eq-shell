import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/format'
import { PortalAnalytics } from './PortalAnalytics'
import { StatusBadge } from '@/components/ui/StatusBadge'

/**
 * Customer portal — "Your Reports" page.
 *
 * Shows all report_deliveries where the customer's email appears
 * in delivered_to. Read-only. No write operations from the portal.
 *
 * Auth: magic-link session. If no session, redirect to login.
 */
export default async function PortalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/portal/login')
  }

  // Find deliveries where this email is in delivered_to
  // Note: Supabase doesn't support array-contains in PostgREST.
  // We use the cs (contains) operator: delivered_to @> ARRAY[email]
  const { data: deliveries, error } = await supabase
    .from('report_deliveries')
    .select(`
      id, revision, delivered_at, signed_url_expires_at,
      content_hash_sha256, download_count, revoked_at,
      delivery_message, revision_reason, pdf_file_path,
      maintenance_checks(id, custom_name, due_date, completed_at, sites(name)),
      customers(name)
    `)
    .contains('delivered_to', [user.email])
    .is('revoked_at', null)
    .order('delivered_at', { ascending: false })
    .limit(100)

  const hasDeliveries = deliveries && deliveries.length > 0

  return (
    <div className="space-y-6">
      <PortalAnalytics portalType="customer_reports" />
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Your Reports</h1>
        <p className="text-sm text-eq-grey mt-1">
          Maintenance reports delivered to <strong className="text-eq-ink">{user.email}</strong>.
        </p>
      </div>

      {!hasDeliveries ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-sm text-eq-grey">No reports have been delivered to this email address yet.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {deliveries.map((delivery) => {
            const rawCheck = delivery.maintenance_checks
            const check = Array.isArray(rawCheck) ? rawCheck[0] : rawCheck
            const rawSite = check ? (check as Record<string, unknown>).sites : null
            const site = Array.isArray(rawSite) ? rawSite[0] : rawSite
            const siteName = (site as Record<string, string> | null)?.name ?? ''
            const checkName = (check as Record<string, unknown> | null)?.custom_name as string | null ?? siteName
            const rawCustomer = delivery.customers
            const customer = Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer
            const customerName = (customer as Record<string, string> | null)?.name ?? ''

            const isExpired = new Date(delivery.signed_url_expires_at) < new Date()

            return (
              <Card key={delivery.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eq-ink">{checkName}</p>
                    <p className="text-xs text-eq-grey mt-0.5">
                      {customerName}{siteName ? ` · ${siteName}` : ''}
                      {delivery.revision > 1 && (
                        <span className="ml-2 inline-block align-middle">
                          <StatusBadge status="overdue" label={`Revision ${delivery.revision}`} dot={false} />
                        </span>
                      )}
                    </p>
                    {delivery.delivery_message && (
                      <p className="text-xs text-eq-grey mt-2 italic">{delivery.delivery_message}</p>
                    )}
                    {delivery.revision_reason && (
                      <p className="text-xs text-amber-600 mt-1">Revision reason: {delivery.revision_reason}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-xs text-eq-grey">{formatDate(delivery.delivered_at)}</p>
                    {isExpired ? (
                      <StatusBadge status="inactive" label="Link expired" />
                    ) : (
                      <StatusBadge status="active" label="Available" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                  {!isExpired && (
                    <>
                      <a
                        href={`/api/portal/download?delivery_id=${delivery.id}&format=docx`}
                        className="px-3 py-1.5 rounded-lg bg-eq-sky text-white text-xs font-medium hover:bg-eq-deep transition-colors"
                      >
                        Download Word
                      </a>
                      {delivery.pdf_file_path && (
                        <a
                          href={`/api/portal/download?delivery_id=${delivery.id}&format=pdf`}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-eq-grey hover:bg-gray-50 transition-colors"
                        >
                          Download PDF
                        </a>
                      )}
                    </>
                  )}
                  <span className="text-xs text-eq-grey ml-auto">
                    Hash: {delivery.content_hash_sha256.slice(0, 12)}...
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div className="text-center pt-4">
        <p className="text-xs text-eq-grey">
          Download links expire 30 days after delivery. Contact your account manager to request a reissue.
        </p>
      </div>
    </div>
  )
}
