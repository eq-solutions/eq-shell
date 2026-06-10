import { z } from 'zod'

const CHECK_STATUSES = ['scheduled', 'in_progress', 'complete', 'overdue', 'cancelled'] as const
const CHECK_ITEM_RESULTS = ['pass', 'fail', 'na'] as const
const MAINTENANCE_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual', '2yr', '3yr', '5yr', '8yr', '10yr'] as const

export const CreateMaintenanceCheckSchema = z.object({
  site_id: z.string().uuid('Valid site is required'),
  frequency: z.enum(MAINTENANCE_FREQUENCIES, { error: 'Frequency is required' }),
  is_dark_site: z.boolean().optional().default(false),
  // Legacy single-plan filter. Kept for backwards compatibility — older
  // callers (import wizard, API) still send one id. When `job_plan_ids`
  // is also provided, the array wins.
  job_plan_id: z.string().uuid().nullable().optional(),
  // Multi-plan filter (Simon 2026-04 feedback item 9 "add multiple JCs").
  // An empty or missing array means "all plans"; one or more uuids narrow
  // the asset filter via `in (...)`.
  job_plan_ids: z.array(z.string().uuid()).optional(),
  custom_name: z.string().max(200).nullable().optional(),
  start_date: z.string().min(1, 'Start date is required'),
  due_date: z.string().min(1, 'Due date is required'),
  assigned_to: z.string().uuid().nullable().optional(),
  maximo_wo_number: z.string().max(100).nullable().optional(),
  maximo_pm_number: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // For manual asset selection (Path B)
  manual_asset_ids: z.array(z.string().uuid()).optional(),
})

export const UpdateMaintenanceCheckSchema = z.object({
  assigned_to: z.string().uuid().nullable().optional(),
  status: z.enum(CHECK_STATUSES).optional(),
  due_date: z.string().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  maximo_wo_number: z.string().max(100).nullable().optional(),
  maximo_pm_number: z.string().max(100).nullable().optional(),
})

export const UpdateCheckItemResultSchema = z.object({
  result: z.enum(CHECK_ITEM_RESULTS).nullable(),
  notes: z.string().max(2000).nullable().optional(),
})

export type CreateMaintenanceCheckInput = z.infer<typeof CreateMaintenanceCheckSchema>
export type UpdateMaintenanceCheckInput = z.infer<typeof UpdateMaintenanceCheckSchema>
export type UpdateCheckItemResultInput = z.infer<typeof UpdateCheckItemResultSchema>
