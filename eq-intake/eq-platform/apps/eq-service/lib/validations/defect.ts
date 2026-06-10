import { z } from 'zod'

const DEFECT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
const DEFECT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

export const RaiseDefectSchema = z.object({
  check_id: z.string().uuid('Valid check is required'),
  check_asset_id: z.string().uuid().optional(),
  asset_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long (max 200)'),
  description: z.string().max(2000, 'Description is too long (max 2000)').optional(),
  severity: z.enum(DEFECT_SEVERITIES, { error: 'Severity is required' }),
})

export const UpdateDefectSchema = z.object({
  status: z.enum(DEFECT_STATUSES).optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  resolution_notes: z.string().max(2000, 'Resolution notes too long (max 2000)').optional(),
  work_order_number: z.string().max(100, 'WO number too long (max 100)').nullable().optional(),
  work_order_date: z.string().nullable().optional(),
})

export type RaiseDefectInput = z.infer<typeof RaiseDefectSchema>
export type UpdateDefectInput = z.infer<typeof UpdateDefectSchema>
