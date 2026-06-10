import { z } from 'zod'

export const CreateNsxTestSchema = z.object({
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
  overall_result: z.enum(['Pending', 'Pass', 'Fail', 'Defect']).default('Pending'),
  notes: z.string().nullable().optional(),
})

export const UpdateNsxTestSchema = CreateNsxTestSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export const CreateNsxReadingSchema = z.object({
  label: z.string().min(1, 'Label is required').max(200),
  value: z.string().min(1, 'Value is required').max(200),
  unit: z.string().max(50).nullable().optional(),
  is_pass: z.boolean().nullable().optional(),
  sort_order: z.coerce.number().int().min(0).default(0),
})

export const UpdateNsxReadingSchema = CreateNsxReadingSchema.partial()

export type CreateNsxTestInput = z.infer<typeof CreateNsxTestSchema>
export type UpdateNsxTestInput = z.infer<typeof UpdateNsxTestSchema>
export type CreateNsxReadingInput = z.infer<typeof CreateNsxReadingSchema>
export type UpdateNsxReadingInput = z.infer<typeof UpdateNsxReadingSchema>
