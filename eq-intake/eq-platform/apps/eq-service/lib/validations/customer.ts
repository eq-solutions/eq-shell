import { z } from 'zod'

export const CreateCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
})

export const UpdateCustomerSchema = CreateCustomerSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>
