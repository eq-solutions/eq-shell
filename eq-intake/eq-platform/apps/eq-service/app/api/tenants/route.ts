import { NextRequest } from 'next/server'
import { getApiUser, isSuperAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { CreateTenantSchema } from '@/lib/validations/tenant'

export async function GET() {
  try {
    const { user, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!isSuperAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) throw error
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch tenants')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!isSuperAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateTenantSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('tenants')
      .insert([{ ...validated, is_active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create tenant')
  }
}
