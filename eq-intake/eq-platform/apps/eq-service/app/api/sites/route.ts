import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateSiteSchema } from '@/lib/validations/site'

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { page, per_page, from, to } = parsePagination(request.nextUrl.searchParams)
    const customerId = request.nextUrl.searchParams.get('customer_id')

    const { supabase } = await getApiUser()

    // Build query for count
    let countQuery = supabase
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    if (customerId) {
      countQuery = countQuery.eq('customer_id', customerId)
    }

    const { count } = await countQuery

    // Build query for data
    let dataQuery = supabase
      .from('sites')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (customerId) {
      dataQuery = dataQuery.eq('customer_id', customerId)
    }

    const { data, error } = await dataQuery.range(from, to)

    if (error) throw error
    const total = count || 0
    return ok(data, paginationMeta(page, per_page, total))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch sites')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateSiteSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('sites')
      .insert([{ ...validated, tenant_id: tenantId, is_active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create site')
  }
}
