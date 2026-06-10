import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateAssetSchema } from '@/lib/validations/asset'

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { page, per_page, from, to } = parsePagination(request.nextUrl.searchParams)
    const siteId = request.nextUrl.searchParams.get('site_id')

    const { supabase } = await getApiUser()

    // Build query for count
    let countQuery = supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    if (siteId) {
      countQuery = countQuery.eq('site_id', siteId)
    }

    const { count } = await countQuery

    // Build query for data
    let dataQuery = supabase
      .from('assets')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (siteId) {
      dataQuery = dataQuery.eq('site_id', siteId)
    }

    const { data, error } = await dataQuery.range(from, to)

    if (error) throw error
    const total = count || 0
    return ok(data, paginationMeta(page, per_page, total))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch assets')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateAssetSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('assets')
      .insert([{ ...validated, tenant_id: tenantId, is_active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create asset')
  }
}
