/**
 * @eq/intake — licence expiry alert generator
 *
 * runLicenceExpiryCheck() queries licences expiring within the next 60 days
 * for the current tenant and raises eq_quality_alerts via the
 * eq_quality_upsert_alert RPC.
 *
 * Severity bands:
 *   < 14 days  → critical
 *   < 30 days  → warning
 *   ≤ 60 days  → info
 */

import type { SupabaseLikeClient } from './canonical/commit-canonical.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LicenceExpiryAlertSummary {
  records_total: number; // all licence records, not just expiring — distinguishes empty table from "all OK"
  total:         number; // expiring or expired within 60 days
  critical:      number;
  warning:       number;
  info:          number;
}

// Raw row shape returned by the licence expiry query
interface LicenceRow {
  licence_id:   string;
  licence_type: string | null;
  expiry_date:  string | null;
  staff_id:     string | null;
  staff_name?:  string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityForDays(daysUntilExpiry: number): 'critical' | 'warning' | 'info' {
  if (daysUntilExpiry < 14) return 'critical';
  if (daysUntilExpiry < 30) return 'warning';
  return 'info';
}

function daysUntil(isoDate: string): number {
  const expiry = new Date(isoDate);
  const now    = new Date();
  // Truncate to date only (midnight UTC)
  expiry.setUTCHours(0, 0, 0, 0);
  now.setUTCHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function buildMessage(row: LicenceRow, days: number): string {
  const type  = row.licence_type ?? 'Licence';
  const staff = row.staff_name   ?? row.staff_id ?? 'unknown staff';
  if (days <= 0) {
    return `${type} for ${staff} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`;
  }
  return `${type} for ${staff} expires in ${days} day${days === 1 ? '' : 's'}.`;
}

// ---------------------------------------------------------------------------
// Public: runLicenceExpiryCheck
//
// Returns the number of alerts raised (inserts + updates via upsert).
// The Supabase client is expected to carry a JWT with app_metadata.tenant_id
// so the RPC can scope to the correct tenant.
// ---------------------------------------------------------------------------

export async function runLicenceExpiryCheck(
  supabase: SupabaseLikeClient,
  tenantId: string,
): Promise<LicenceExpiryAlertSummary> {
  // Fetch licences expiring within 60 days.
  // We call the tidy read RPC to stay within RLS — it returns all licences
  // for the current tenant. We filter in JS to avoid adding a new RPC.
  const { data: rawData, error } = await (supabase as unknown as {
    rpc: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('eq_tidy_read_entity', { p_table: 'licences' });

  if (error) {
    throw new Error(`runLicenceExpiryCheck: failed to read licences — ${error.message}`);
  }

  const rows = (rawData as LicenceRow[] | null) ?? [];

  const now   = new Date();
  const limit = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // +60 days

  const summary: LicenceExpiryAlertSummary = { records_total: rows.length, total: 0, critical: 0, warning: 0, info: 0 };

  for (const row of rows) {
    if (!row.expiry_date) continue;

    const expiry = new Date(row.expiry_date);
    // Only alert for licences expiring within 60 days (or already expired)
    if (expiry > limit) continue;

    const days     = daysUntil(row.expiry_date);
    const severity = severityForDays(days);
    const message  = buildMessage(row, days);

    // Upsert alert via the guardian RPC
    const { error: alertError } = await (supabase as unknown as {
      rpc: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('eq_quality_upsert_alert', {
      p_tenant_id:   tenantId,
      p_alert_type:  'licence_expiry',
      p_entity_type: 'licence',
      p_entity_id:   row.licence_id,
      p_message:     message,
      p_severity:    severity,
    });

    if (alertError) {
      // Non-fatal — log and continue
      console.warn(`runLicenceExpiryCheck: upsert alert failed for ${row.licence_id}: ${alertError.message}`);
      continue;
    }

    summary.total++;
    summary[severity]++;
  }

  return summary;
}
