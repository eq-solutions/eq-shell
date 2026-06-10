import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateCustomerSchema } from '@/lib/validations/customer'

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { page, per_page, from, to } = parsePagination(request.nextUrl.searchParams)
    const { supabase } = await getApiUser()

    // Get total count
    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    // Fetch paginated data
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) throw error
    const total = count || 0
    return ok(data, paginationMeta(page, per_page, total))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch customers')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateCustomerSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('customers')
      .insert([{ ...validated, tenant_id: tenantId, is_active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create customer')
  }
}
