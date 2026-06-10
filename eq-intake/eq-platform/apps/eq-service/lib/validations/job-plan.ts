import { z } from 'zod'

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'biannual', 'annual', 'ad_hoc'] as const

export const CreateJobPlanSchema = z.object({
  site_id: z.string().uuid('Valid site is required').nullable().optional(),
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().max(50).nullable().optional(),
  type: z.string().max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  frequency: z.enum(FREQUENCIES).nullable().optional(),
})

export const UpdateJobPlanSchema = CreateJobPlanSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export const CreateJobPlanItemSchema = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  sort_order: z.number().int().min(0).optional().default(0),
  is_required: z.boolean().optional().default(true),
  dark_site: z.boolean().optional().default(false),
  freq_monthly: z.boolean().optional().default(false),
  freq_quarterly: z.boolean().optional().default(false),
  freq_semi_annual: z.boolean().optional().default(false),
  freq_annual: z.boolean().optional().default(false),
  freq_2yr: z.boolean().optional().default(false),
  freq_3yr: z.boolean().optional().default(false),
  freq_5yr: z.boolean().optional().default(false),
  freq_8yr: z.boolean().optional().default(false),
  freq_10yr: z.boolean().optional().default(false),
})

export const UpdateJobPlanItemSchema = CreateJobPlanItemSchema.partial()

export type CreateJobPlanInput = z.infer<typeof CreateJobPlanSchema>
export type UpdateJobPlanInput = z.infer<typeof UpdateJobPlanSchema>
export type CreateJobPlanItemInput = z.infer<typeof CreateJobPlanItemSchema>
export type UpdateJobPlanItemInput = z.infer<typeof UpdateJobPlanItemSchema>
