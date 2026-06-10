import { NextRequest } from 'next/server'
import { getApiUser, isSuperAdmin } from '@/lib/api/auth'
import { ok, err, unauthorized, forbidden, notFound } from '@/lib/api/response'
import { UpdateTenantSchema } from '@/lib/validations/tenant'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!isSuperAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch tenant')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!isSuperAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = UpdateTenantSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('tenants')
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to update tenant')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!isSuperAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()
    const { error } = await supabase
      .from('tenants')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok({ id })
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to delete tenant')
  }
}
