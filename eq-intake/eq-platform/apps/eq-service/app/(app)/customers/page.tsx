import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CustomerList } from './CustomerList'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

const PER_PAGE = 25

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

  // Get current user role
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Build query
  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .order('name')

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: customers, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Customers' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Customers</h1>
      </div>
      <CustomerList
        customers={customers ?? []}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
      />
    </div>
  )
}
