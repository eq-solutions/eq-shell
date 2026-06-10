import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Portal sign-out. Clears the Supabase session cookie and bounces the
 * user back to the portal login page. POST-only (matches the form
 * method); GET returns a redirect for direct hits.
 */
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(
    new URL('/portal/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  )
}

export async function GET() {
  return NextResponse.redirect(
    new URL('/portal/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  )
}
