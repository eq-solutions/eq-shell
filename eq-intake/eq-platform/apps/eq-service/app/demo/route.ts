/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Shareable demo entry point.
 *
 * GET /demo  →  signs the visitor in as the public demo user and redirects
 *               to /dashboard. Safe to embed in marketing links, emails,
 *               social posts, conference slides, etc.
 *
 * Anyone already signed in under a different account will have their
 * session swapped for the demo session (intentional — this link is
 * advertised as "enter the demo").
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/utils/demo'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  })

  if (error) {
    // Fall back to the signin page with a readable error flag
    const url = new URL('/auth/signin', request.url)
    url.searchParams.set('error', 'demo_unavailable')
    return NextResponse.redirect(url)
  }

  // Best-effort update of last_login_at — ignore failures
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
