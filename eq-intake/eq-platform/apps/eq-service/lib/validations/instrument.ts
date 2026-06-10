import { z } from 'zod'

export const CreateInstrumentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  instrument_type: z.string().min(1, 'Instrument type is required').max(100),
  make: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  asset_tag: z.string().max(100).nullable().optional(),
  calibration_date: z.string().nullable().optional(),
  calibration_due: z.string().nullable().optional(),
  calibration_cert: z.string().max(200).nullable().optional(),
  status: z.enum(['Active', 'Out for Cal', 'Retired', 'Lost']).default('Active'),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const UpdateInstrumentSchema = CreateInstrumentSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateInstrumentInput = z.infer<typeof CreateInstrumentSchema>
export type UpdateInstrumentInput = z.infer<typeof UpdateInstrumentSchema>
