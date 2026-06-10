import type { Role } from '@/lib/types'

const ADMIN_ROLES: Role[] = ['super_admin', 'admin']
const WRITE_ROLES: Role[] = ['super_admin', 'admin', 'supervisor']
const CHECK_CREATOR_ROLES: Role[] = ['super_admin', 'admin', 'supervisor', 'technician']

export function isAdmin(role: Role | null): boolean {
  return role !== null && ADMIN_ROLES.includes(role)
}

export function canWrite(role: Role | null): boolean {
  return role !== null && WRITE_ROLES.includes(role)
}

// Narrow allowance for spinning up a maintenance_check on-site. Mirrors the
// RLS policy "Writers can create checks" from migration 0080, which includes
// technician — broader than canWrite() so a tech can start an ad-hoc check
// without flagging down a supervisor. Use this ONLY for the check-creation
// path; other mutations should keep using canWrite().
export function canCreateCheck(role: Role | null): boolean {
  return role !== null && CHECK_CREATOR_ROLES.includes(role)
}

// Allowance for on-site test execution — recording results, saving the
// per-step ACB/NSX wizard state, editing RCD circuit timings, marking a
// test complete. Mirrors the RLS policies on acb_tests / nsx_tests /
// rcd_tests / rcd_test_circuits (migrations 0069 + 0081) which all
// include 'technician' in the writer list. Without this gate the UI
// blocks the tech from saving even though RLS allows it.
//
// Use canDoTestWork for the test workflow itself (the on-site flow).
// Keep canWrite() for admin-style operations: bulk xlsx imports,
// deleting tests, breaker-detail edits, cross-asset operations. Those
// are supervisor-or-above.
export function canDoTestWork(role: Role | null): boolean {
  return role !== null && CHECK_CREATOR_ROLES.includes(role)
}

export function isSuperAdmin(role: Role | null): boolean {
  return role === 'super_admin'
}

// ── Import permissions ──────────────────────────────────────────────
//
// Each importer in the app uses a role gate from the helpers above; the
// audit done in /docs/reviews/2026-05-21-import-audit flagged the
// per-flow inconsistency. This block documents the decisions so the
// next reviewer doesn't think they're accidental.
//
//   /testing/acb         importAcbCollectionAction      → canDoTestWork
//   /maintenance/import  commit{,Consolidated}Delta…    → canWrite
//   /testing/rcd/import  commitJemenaRcdImportAction    → canWrite
//   /contract-scope      importScopeItemsAction         → canWrite
//   /commercials/…       commitImportAction (sheet)     → isAdmin
//
// Rationale:
//   * ACB collection round-trips technician-authored data. The same
//     tech can already update one breaker at a time via the workflow
//     UI; offline bulk-fill is an ergonomic shortcut for the same
//     write, so the gate matches (canDoTestWork = supervisor + tech).
//   * Delta WO + RCD imports create or replace many maintenance
//     checks across assets and sites — a supervisor-or-above call
//     because it shapes the team's work, not just one breaker.
//   * Commercial-sheet is wipe-and-replace at the customer-FY level
//     and pivots multi-year cost numbers. Admin-only — the audit-log
//     pre-wipe snapshot is the recovery path if it goes sideways.
//
// `canImport` is an alias for the common case (everything except ACB
// + commercial-sheet) so new importers default to the right gate
// without having to re-derive the reasoning.
export function canImport(role: Role | null): boolean {
  return canWrite(role)
}
