import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, err, unauthorized, forbidden, notFound } from '@/lib/api/response'
import { UpdateJobPlanSchema } from '@/lib/validations/job-plan'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('job_plans')
      .select(`
        *,
        job_plan_items (
          id,
          tenant_id,
          job_plan_id,
          asset_id,
          description,
          sort_order,
          is_required,
          created_at,
          updated_at
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan')
      throw error
    }
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch maintenance plan')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = UpdateJobPlanSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('job_plans')
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan')
      throw error
    }
    return ok(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to update maintenance plan')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()
    const { error } = await supabase
      .from('job_plans')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan')
      throw error
    }
    return ok({ id })
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to delete maintenance plan')
  }
}
