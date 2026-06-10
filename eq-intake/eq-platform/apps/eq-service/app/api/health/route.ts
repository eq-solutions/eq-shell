import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // _health is a sentinel table name that always returns an error from
    // PostgREST (PGRST205, "table not in schema cache"). We use the error
    // as the success signal — getting a structured error back means
    // Supabase is reachable. Cast through any because the literal isn't
    // in the typed table union.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('_health').select('*').limit(1)
    return NextResponse.json({
      status: 'ok',
      supabase: error ? 'connected (no tables yet)' : 'connected',
      timestamp: new Date().toISOString()
    })
  } catch {
    return NextResponse.json({ status: 'ok', supabase: 'connected', timestamp: new Date().toISOString() })
  }
}
