import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/portal/download?delivery_id=xxx&format=docx|pdf
 *
 * Generates a fresh signed URL for a report delivery and redirects
 * the browser to it. Works for both portal customers (magic-link
 * session) and internal app users.
 *
 * Security:
 * - Authenticated user must exist (Supabase session)
 * - For portal users: their email must appear in delivered_to
 * - For internal users: RLS on report_deliveries already scopes by tenant
 * - Delivery must not be revoked
 * - Signed URL must not have expired (based on signed_url_expires_at)
 */
export async function GET(request: NextRequest) {
  try {
    const deliveryId = request.nextUrl.searchParams.get('delivery_id')
    const format = request.nextUrl.searchParams.get('format') ?? 'docx'

    if (!deliveryId) {
      return NextResponse.json({ error: 'delivery_id is required' }, { status: 400 })
    }

    if (!['docx', 'pdf'].includes(format)) {
      return NextResponse.json({ error: 'format must be docx or pdf' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch the delivery — RLS handles tenant scoping for internal users
    const { data: delivery, error } = await supabase
      .from('report_deliveries')
      .select('id, pdf_file_path, docx_file_path, delivered_to, signed_url_expires_at, revoked_at, download_count')
      .eq('id', deliveryId)
      .single()

    if (error || !delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    // Portal users: verify their email is in delivered_to
    const emailInDeliveredTo = (delivery.delivered_to as string[]).includes(user.email.toLowerCase())

    // Check if user is a tenant member (internal user) — if not, they must be in delivered_to
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    const isInternalUser = !!membership
    if (!isInternalUser && !emailInDeliveredTo) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check revocation
    if (delivery.revoked_at) {
      return NextResponse.json({ error: 'This report has been revoked' }, { status: 410 })
    }

    // Check expiry
    if (new Date(delivery.signed_url_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Download link has expired. Contact your account manager to request a reissue.' }, { status: 410 })
    }

    // Resolve file path
    const filePath = format === 'pdf' ? delivery.pdf_file_path : delivery.docx_file_path
    if (!filePath) {
      return NextResponse.json(
        { error: format === 'pdf' ? 'PDF not yet generated for this report' : 'File not found' },
        { status: 404 },
      )
    }

    // Generate a short-lived signed URL (1 hour) for the actual download
    const { data: signedUrlData, error: signedError } = await supabase.storage
      .from('attachments')
      .createSignedUrl(filePath, 60 * 60) // 1 hour

    if (signedError || !signedUrlData?.signedUrl) {
      console.error('Signed URL generation failed:', signedError?.message)
      return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 })
    }

    // Increment download count (fire-and-forget)
    supabase
      .from('report_deliveries')
      .update({ download_count: (delivery.download_count ?? 0) + 1 })
      .eq('id', deliveryId)
      .then(() => { /* intentionally swallowed */ })

    // Redirect to the signed URL — browser starts download immediately
    return NextResponse.redirect(signedUrlData.signedUrl)
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
