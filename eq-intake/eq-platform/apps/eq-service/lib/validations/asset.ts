import { z } from 'zod'

export const CreateAssetSchema = z.object({
  site_id: z.string().uuid('Valid site is required'),
  name: z.string().min(1, 'Name is required').max(200),
  asset_type: z.string().min(1, 'Asset type is required').max(50),
  manufacturer: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  maximo_id: z.string().max(50).nullable().optional(),
  install_date: z.string().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  job_plan_id: z.string().uuid().nullable().optional(),
  dark_site_test: z.boolean().optional(),
})

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>
export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>
