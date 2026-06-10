import { z } from 'zod'

export const CreateAcbTestSchema = z.object({
  asset_id: z.string().uuid('Valid asset is required'),
  site_id: z.string().uuid('Valid site is required'),
  test_date: z.string().min(1, 'Test date is required'),
  tested_by: z.string().uuid().nullable().optional(),
  test_type: z.enum(['Initial', 'Routine', 'Special']).default('Routine'),
  cb_make: z.string().max(100).nullable().optional(),
  cb_model: z.string().max(100).nullable().optional(),
  cb_serial: z.string().max(100).nullable().optional(),
  cb_rating: z.string().max(50).nullable().optional(),
  cb_poles: z.string().max(10).nullable().optional(),
  trip_unit: z.string().max(100).nullable().optional(),
  trip_settings_ir: z.string().max(50).nullable().optional(),
  trip_settings_isd: z.string().max(50).nullable().optional(),
  trip_settings_ii: z.string().max(50).nullable().optional(),
  trip_settings_ig: z.string().max(50).nullable().optional(),
  overall_result: z.enum(['Pending', 'Pass', 'Fail', 'Defect']).default('Pending'),
  notes: z.string().nullable().optional(),
})

export const UpdateAcbTestSchema = CreateAcbTestSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export const CreateAcbReadingSchema = z.object({
  label: z.string().min(1, 'Label is required').max(200),
  value: z.string().min(1, 'Value is required').max(200),
  unit: z.string().max(50).nullable().optional(),
  is_pass: z.boolean().nullable().optional(),
  sort_order: z.coerce.number().int().min(0).default(0),
})

export const UpdateAcbReadingSchema = CreateAcbReadingSchema.partial()

export type CreateAcbTestInput = z.infer<typeof CreateAcbTestSchema>
export type UpdateAcbTestInput = z.infer<typeof UpdateAcbTestSchema>
export type CreateAcbReadingInput = z.infer<typeof CreateAcbReadingSchema>
export type UpdateAcbReadingInput = z.infer<typeof UpdateAcbReadingSchema>
