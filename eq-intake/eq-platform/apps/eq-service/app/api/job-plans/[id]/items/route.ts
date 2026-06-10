import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden, notFound } from '@/lib/api/response'
import { CreateJobPlanItemSchema } from '@/lib/validations/job-plan'

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

    // Verify maintenance plan exists and belongs to tenant
    const { data: jobPlan, error: jobPlanError } = await supabase
      .from('job_plans')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (jobPlanError || !jobPlan) {
      return notFound('Job plan')
    }

    // Get items
    const { data, error } = await supabase
      .from('job_plan_items')
      .select('*')
      .eq('job_plan_id', id)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (error) throw error
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch maintenance plan items')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId, role } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const { supabase } = await getApiUser()

    // Verify maintenance plan exists and belongs to tenant
    const { data: jobPlan, error: jobPlanError } = await supabase
      .from('job_plans')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (jobPlanError || !jobPlan) {
      return notFound('Job plan')
    }

    const body = await request.json()
    const validated = CreateJobPlanItemSchema.parse(body)

    const { data, error } = await supabase
      .from('job_plan_items')
      .insert([{ ...validated, job_plan_id: id, tenant_id: tenantId }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create maintenance plan item')
  }
}
