/**
 * GET /api/reports/preview-pm-check?check_id=<uuid>
 *
 * Returns the maintenance check report as a PDF, rendered inline in the
 * browser. Auth-gated — the request must come from a signed-in user with
 * write access (any role except read_only).
 *
 * This is the Phase 1b preview endpoint. The customer-facing email path
 * (issueMaintenanceReportAction) still produces the legacy DOCX. Once we're
 * happy with the PDF visual we'll wire this into the email flow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { generatePmCheckPdf } from '@/lib/reports/generate-pm-check-pdf'

export async function GET(request: NextRequest) {
  try {
    const checkId = request.nextUrl.searchParams.get('check_id')
    if (!checkId) {
      return NextResponse.json({ error: 'Missing check_id' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!membership || !canWrite(membership.role as Role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const pdf = await generatePmCheckPdf(supabase, membership.tenant_id, checkId)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="maintenance-check-${checkId.slice(0, 8)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('preview-pm-check error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
