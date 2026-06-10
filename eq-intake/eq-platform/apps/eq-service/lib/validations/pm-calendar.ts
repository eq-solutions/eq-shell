import { z } from 'zod'

export const PM_CATEGORIES = [
  'Thermal scanning',
  'Dark site test',
  'Emergency lighting',
  'Lightning protection testing',
  'Management',
  'RCD testing',
  'Test and tagging',
  'Quarterly maintenance',
  'WOs',
] as const

export const CreatePmCalendarSchema = z.object({
  site_id: z.string().uuid('Site is required'),
  title: z.string().min(1, 'Title is required').max(300),
  location: z.string().max(300).nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().min(1, 'Category is required').max(100),
  start_time: z.string().min(1, 'Start time is required'),
  end_time: z.string().nullable().optional(),
  hours: z.coerce.number().min(0).default(0),
  contractor_materials_cost: z.coerce.number().min(0).default(0),
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).nullable().optional(),
  financial_year: z.string().max(20).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).default('scheduled'),
  // Future notification fields
  reminder_days_before: z.array(z.number().int().positive()).default([]),
  notification_recipients: z.array(z.string().email()).default([]),
  email_template: z.string().nullable().optional(),
})

export const UpdatePmCalendarSchema = CreatePmCalendarSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreatePmCalendarInput = z.infer<typeof CreatePmCalendarSchema>
export type UpdatePmCalendarInput = z.infer<typeof UpdatePmCalendarSchema>
