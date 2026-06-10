# Performance Advisors Summary — 2026-04-18

**Project:** urjhmkhbgaxrofurpbgc (EQ Solves Service)  
**Total lints:** 187  
**Status:** PASS (no ERROR-level findings)

---

## Lint Counts by Severity

| Level | Count |
|-------|-------|
| INFO  | 89    |
| WARN  | 98    |
| ERROR | 0     |

---

## ERROR-Level Findings

**None.** No critical issues requiring immediate action.

---

## Top 5 WARN-Level Lint Types

### 1. Duplicate Index (55 findings)
Identical indexes exist on 24 tables. These are noise/cleanup — low impact on production performance, but noisy in schema.  
**Actionability:** Low (maintenance debt, not a correctness issue)  
**Example:** `acb_test_readings` has identical indexes `idx_acb_readings_test` and `idx_acb_test_readings_acb_test_id` — drop one.

### 2. Auth RLS Init Plan (23 findings) **ACTIONABLE**
11 tables have RLS policies that re-evaluate `auth.uid()` or `auth.role()` **for each row** instead of once per query.  
**Affected tables:** check_assets, contract_scopes, customer_contacts, maintenance_check_items, maintenance_checks, mfa_recovery_codes, notifications, profiles, site_contacts, test_record_readings, test_records  
**Fix:** Wrap `auth.uid()` in `(select auth.uid())` per [Supabase docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select). Already documented in AGENTS.md but not yet applied.  
**Impact:** Performance optimization for row-heavy queries (tenant_members queries, asset filtering).  

### 3. Multiple Permissive Policies (20 findings) **ACTIONABLE**
4 tables have overlapping `SELECT` policies for the same role, increasing planner complexity:  
- customer_contacts (2 overlaps)  
- profiles (overlaps)  
- site_contacts (2 overlaps)  
- testing_checks (overlaps)  

**Fix:** Consolidate overlapping permissive `SELECT` policies or split into explicit INSERT/UPDATE/DELETE per AGENTS.md RLS guidelines.  
**Impact:** Cleaner policy logic, minor query planner improvement.

### 4. Unused Index (86 findings)
86 indexes across 29 tables not used in the past monitoring window. Likely accumulated from past schema experiments or superseded by newer indexes.  
**Actionability:** Medium (cleanup to reduce maintenance load, but safe to remove after verification).  
**Top affected tables:** acb_tests, audit_logs, maintenance_checks, nsx_tests, test_records.

### 5. Unindexed Foreign Keys (2 findings)
`report_deliveries` has two FKs without covering indexes:  
- `report_deliveries_delivered_by_fkey`  
- `report_deliveries_revoked_by_fkey`  

**Fix:** Add indexes on `delivered_by` and `revoked_by` columns.  
**Impact:** Minimal (report_deliveries is small), but good practice.

---

## Actionable vs. Noise

| Finding | Actionable | Effort | Priority |
|---------|-----------|--------|----------|
| Auth RLS Init Plan | ✓ Yes | 2–3 hours | High — performance gate |
| Multiple Permissive Policies | ✓ Yes | 1 hour | Medium — code cleanliness |
| Unindexed Foreign Keys | ✓ Yes | 30 min | Low — small table |
| Duplicate Index | Cleanup only | 1 hour | Low — post-release |
| Unused Index | Cleanup only | 2–3 hours | Low — post-release |

---

## Gating Decision

No ERROR-level lints. **GATE PASSES.** Actionable WARNs are deferred to post-release cleanup unless performance regression is detected.
