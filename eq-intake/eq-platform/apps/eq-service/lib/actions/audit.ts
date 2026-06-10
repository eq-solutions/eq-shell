'use server'

import { requireUser } from '@/lib/actions/auth'

/**
 * Log an audit event. Called from other server actions after successful mutations.
 * Silently fails — audit logging should never block the primary action.
 *
 * If `mutationId` is provided, the row is written with that id attached so
 * future replays of the same client-generated mutation can detect and
 * short-circuit via `isMutationProcessed()`. See `withIdempotency()` for the
 * wrapper pattern.
 */
export async function logAuditEvent(opts: {
  action: string
  entityType: string
  entityId?: string | null
  summary?: string
  metadata?: Record<string, unknown>
  mutationId?: string | null
}) {
  try {
    const { supabase, tenantId, user } = await requireUser()
    // metadata is typed as Record<string, unknown> on the opts API for caller
    // convenience but the audit_logs.metadata column is jsonb — Supabase types
    // it as `Json` which is a recursive union. Cast through unknown to bridge;
    // every caller passes a serialisable object, the cast just satisfies TS.
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      summary: opts.summary ?? null,
      metadata: (opts.metadata ?? {}) as never,
      mutation_id: opts.mutationId ?? null,
    })
  } catch {
    // Silently fail — audit should not break primary operations
  }
}

/**
 * Check whether a given client-generated `mutationId` has already been
 * processed for the current tenant. Used by server actions that opt into
 * replay-safe (idempotent) execution — e.g. offline sync replay, AI-suggested
 * actions, network retry logic.
 *
 * Returns `false` on any error so the caller falls through to running the
 * mutation. Errors will be caught again by the unique index on
 * `(tenant_id, mutation_id)`, which is the actual source of truth.
 */
export async function isMutationProcessed(mutationId: string): Promise<boolean> {
  try {
    const { supabase, tenantId } = await requireUser()
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('mutation_id', mutationId)
      .limit(1)
      .maybeSingle()
    if (error) return false
    return data !== null
  } catch {
    return false
  }
}
