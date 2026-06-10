// NOT marked 'use server'. withIdempotency takes a function callback —
// server actions can't accept function arguments anyway, so calling this
// from the client would never have worked. The directive was unused at
// best, a footgun at worst (every export would have been registered as
// a public RPC endpoint). Removed 2026-04-27.

import { isMutationProcessed } from '@/lib/actions/audit'

/**
 * Standard success-or-error result shape used across EQ Solves server actions.
 * Extended with `idempotent` so callers can tell a no-op replay apart from
 * a fresh mutation if they care (most don't).
 */
export type ActionResult<T = unknown> =
  | { success: true; data?: T; idempotent?: boolean }
  | { success: false; error: string }

/**
 * Wraps a mutation so it is safe to replay. If `mutationId` is provided and
 * has already been processed for this tenant, the wrapped function is NOT
 * re-executed — instead we return `{ success: true, idempotent: true }`.
 *
 * Pattern inside a server action:
 *
 *     export async function doThing(checkId: string, mutationId?: string) {
 *       return withIdempotency(mutationId, async () => {
 *         const { supabase, role } = await requireUser()
 *         if (!canWrite(role)) return { success: false, error: 'Forbidden' }
 *         // ... mutation ...
 *         await logAuditEvent({ action: 'update', entityType: 'thing',
 *                               entityId: checkId, mutationId })
 *         revalidatePath('/things')
 *         return { success: true }
 *       })
 *     }
 *
 * The audit row inserted inside the wrapped function must carry the same
 * `mutationId`, which is what makes future replays detectable. The unique
 * index on `(tenant_id, mutation_id)` is the backstop if two replays race
 * past the `isMutationProcessed` check.
 *
 * When `mutationId` is omitted the wrapper is a pass-through — legacy call
 * sites keep working with zero behaviour change.
 */
export async function withIdempotency<T>(
  mutationId: string | undefined | null,
  fn: () => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  if (mutationId) {
    const alreadyProcessed = await isMutationProcessed(mutationId)
    if (alreadyProcessed) {
      return { success: true, idempotent: true }
    }
  }

  try {
    return await fn()
  } catch (err) {
    // Unique-constraint race: a concurrent replay won. Treat as success.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('idx_audit_mutation_id_unique') || msg.includes('duplicate key')) {
      return { success: true, idempotent: true }
    }
    return { success: false, error: msg }
  }
}
