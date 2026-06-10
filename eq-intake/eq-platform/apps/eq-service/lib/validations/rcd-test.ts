import { z } from 'zod'

const RCD_TEST_STATUSES = ['draft', 'complete', 'archived'] as const

// Timing values are stored as text on rcd_test_circuits to allow Jemena's
// "" non-trip indicator. Cap length defensively to prevent abuse.
const TimingValue = z.string().max(20).nullable().optional()

export const UpdateRcdTestHeaderSchema = z.object({
  technician_name_snapshot: z.string().max(120).nullable().optional(),
  technician_initials: z.string().max(8).nullable().optional(),
  site_rep_name: z.string().max(120).nullable().optional(),
  equipment_used: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(RCD_TEST_STATUSES).optional(),
})

export const UpdateRcdCircuitSchema = z.object({
  id: z.string().uuid('Circuit id required'),
  x1_no_trip_0_ms: TimingValue,
  x1_no_trip_180_ms: TimingValue,
  x1_trip_0_ms: TimingValue,
  x1_trip_180_ms: TimingValue,
  x5_fast_0_ms: TimingValue,
  x5_fast_180_ms: TimingValue,
  trip_test_button_ok: z.boolean().optional(),
  action_taken: z.string().max(500).nullable().optional(),
  is_critical_load: z.boolean().optional(),
})

export const UpdateRcdCircuitsBatchSchema = z.object({
  circuits: z.array(UpdateRcdCircuitSchema).min(1, 'At least one circuit required'),
})

/**
 * Combined header + circuits payload for the atomic
 * `saveRcdTestCompleteAction` (audit #103).
 *
 * Both halves are optional in the sense that you can save header-only
 * or circuits-only — but at least one must carry content for the
 * action to do useful work. `markComplete` is a separate flag so
 * the client doesn't have to inject `status: 'complete'` into the
 * header payload itself (cleaner intent at the call site, and the
 * RPC honours it independently of header.status to avoid race-y
 * "I forgot to set status" footguns).
 */
export const SaveRcdTestCompleteSchema = z.object({
  header: UpdateRcdTestHeaderSchema,
  circuits: z.array(UpdateRcdCircuitSchema),
  markComplete: z.boolean(),
})

export type UpdateRcdTestHeaderInput = z.infer<typeof UpdateRcdTestHeaderSchema>
export type UpdateRcdCircuitInput = z.infer<typeof UpdateRcdCircuitSchema>
export type UpdateRcdCircuitsBatchInput = z.infer<typeof UpdateRcdCircuitsBatchSchema>
export type SaveRcdTestCompleteInput = z.infer<typeof SaveRcdTestCompleteSchema>
