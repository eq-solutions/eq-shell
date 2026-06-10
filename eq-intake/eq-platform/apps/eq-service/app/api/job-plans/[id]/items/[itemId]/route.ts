import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, err, unauthorized, forbidden, notFound } from '@/lib/api/response'
import { UpdateJobPlanItemSchema } from '@/lib/validations/job-plan'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params
    const { user, tenantId } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('job_plan_items')
      .select('*')
      .eq('id', itemId)
      .eq('job_plan_id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan item')
      throw error
    }
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch maintenance plan item')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = UpdateJobPlanItemSchema.parse(body)

    const { supabase } = await getApiUser()
    const { data, error } = await supabase
      .from('job_plan_items')
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('job_plan_id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan item')
      throw error
    }
    return ok(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to update maintenance plan item')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()
    const { error } = await supabase
      .from('job_plan_items')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('job_plan_id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      if (error.code === 'PGRST116') return notFound('Job plan item')
      throw error
    }
    return ok({ id: itemId })
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to delete maintenance plan item')
  }
}
