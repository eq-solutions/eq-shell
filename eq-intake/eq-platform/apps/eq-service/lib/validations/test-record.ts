import { z } from 'zod'

const TEST_RESULTS = ['pending', 'pass', 'fail', 'defect'] as const

export const CreateTestRecordSchema = z.object({
  asset_id: z.string().uuid('Valid asset is required'),
  site_id: z.string().uuid('Valid site is required'),
  test_type: z.string().min(1, 'Test type is required').max(100),
  test_date: z.string().min(1, 'Test date is required'),
  tested_by: z.string().uuid().nullable().optional(),
  result: z.enum(TEST_RESULTS).optional().default('pending'),
  notes: z.string().max(2000).nullable().optional(),
  next_test_due: z.string().nullable().optional(),
})

export const UpdateTestRecordSchema = CreateTestRecordSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export const CreateTestReadingSchema = z.object({
  label: z.string().min(1, 'Label is required').max(200),
  value: z.string().max(200).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  pass: z.boolean().nullable().optional(),
  sort_order: z.number().int().min(0).optional().default(0),
})

export const UpdateTestReadingSchema = CreateTestReadingSchema.partial()

export type CreateTestRecordInput = z.infer<typeof CreateTestRecordSchema>
export type UpdateTestRecordInput = z.infer<typeof UpdateTestRecordSchema>
export type CreateTestReadingInput = z.infer<typeof CreateTestReadingSchema>
export type UpdateTestReadingInput = z.infer<typeof UpdateTestReadingSchema>
