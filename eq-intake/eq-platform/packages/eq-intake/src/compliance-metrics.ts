/**
 * @eq/intake — compliance metrics
 *
 * computeComplianceMetrics() reads active staff and all licence records and
 * returns the counts needed to drive the Compliance and Serviceability
 * dimensions of the data health score.
 *
 * Kept separate from computeHealthScores() so the caller can fire all four
 * health-home queries in parallel.
 */

import type { SupabaseLikeClient } from './canonical/commit-canonical.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplianceMetrics {
  staff: {
    total:                 number;
    has_email:             number;
    has_phone:             number;
    has_trade:             number;
    has_emergency_contact: number;
  };
  licences: {
    total: number; // total licence records (not just expiring)
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RpcClient = {
  rpc: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function notBlank(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public: computeComplianceMetrics
// ---------------------------------------------------------------------------

export async function computeComplianceMetrics(
  supabase: SupabaseLikeClient,
): Promise<ComplianceMetrics> {
  const client = supabase as unknown as RpcClient;

  const [staffResult, licenceResult] = await Promise.all([
    client.rpc('eq_tidy_read_entity', { p_table: 'staff' }),
    client.rpc('eq_tidy_read_entity', { p_table: 'licences' }),
  ]);

  // Filter to active staff only (mirrors the live query)
  const staffRows = (
    (staffResult.data as Record<string, unknown>[] | null) ?? []
  ).filter((r) => r['active'] !== false);

  const licenceRows = (licenceResult.data as Record<string, unknown>[] | null) ?? [];

  return {
    staff: {
      total:                 staffRows.length,
      has_email:             staffRows.filter((r) => notBlank(r['email'])).length,
      has_phone:             staffRows.filter((r) => notBlank(r['phone'])).length,
      has_trade:             staffRows.filter((r) => notBlank(r['trade'])).length,
      has_emergency_contact: staffRows.filter((r) => notBlank(r['emergency_contact_name'])).length,
    },
    licences: {
      total: licenceRows.length,
    },
  };
}
