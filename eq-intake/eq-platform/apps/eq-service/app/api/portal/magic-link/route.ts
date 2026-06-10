import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/portal/magic-link
 *
 * Sends a magic-link email to the customer's email address.
 * Only works if the email appears in at least one report_deliveries row
 * (i.e. we have actually sent a report to this person).
 *
 * This prevents random emails from triggering magic links — you can
 * only log in to the portal if you have been a report recipient.
 */
export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 })
    }

    const normalised = email.trim().toLowerCase()
    const supabase = await createClient()

    // Verify this email has received at least one report delivery
    const { count } = await supabase
      .from('report_deliveries')
      .select('*', { count: 'exact', head: true })
      .contains('delivered_to', [normalised])

    if (!count || count === 0) {
      // Do not reveal whether the email exists — always return success
      // to prevent email enumeration. The user just won't receive a link.
      return NextResponse.json({ success: true })
    }

    // Send magic link via Supabase Auth
    const { error } = await supabase.auth.signInWithOtp({
      email: normalised,
      options: {
        emailRedirectTo: `${getBaseUrl()}/portal`,
        shouldCreateUser: true, // Creates a minimal auth.users row if needed
      },
    })

    if (error) {
      console.error('Magic link error:', error.message)
      // Still return success to prevent enumeration
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 })
  }
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
