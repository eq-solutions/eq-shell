# Staged migrations — gated, NOT auto-applied

These SQL files are **ready to run but deliberately not applied** — each touches a
surface behind a sign-off gate (control plane, live-SKS data, or the Quotes silo).
They live here, **outside `tenant-migrations/`**, so the migrate-tenants runner never
picks them up automatically. Apply each by hand (Supabase MCP `apply_migration` or the
SQL editor) once its gate clears.

Source review: [`docs/FINAL-SPRINT.md`](../../docs/FINAL-SPRINT.md) — Phases 2–3.

| File | Target | Gate | Status | What / why |
|---|---|---|---|---|
| `jvkn_auth_rpc_hardening.sql` | jvkn | 🔒 auth | ✅ **APPLIED** 2026-05-30 (`harden_auth_pin_rpcs_revoke_anon`) | Revoked `anon`/`authenticated` on the 3 admin PIN primitives; service_role retained (verified). Kept here as the change record. |
| `sks_overlay_fn_revoke.sql` | ehowg | 🔒 | ✅ **APPLIED** 2026-05-30 (`revoke_sks_overlay_fn_grants`) | Revoked `anon`/`authenticated` on the 5 `_sks_*` trigger fns. |
| `sks_safety_rpc_hardening.sql` | ehowg | 🔒🔒 | 🟡 staged — **no current exposure** (SKS single-tenant; no caller found by name) | `approve/submit_safety_record` trust a caller-supplied `p_tenant_id`. Apply the right option when SKS goes multi-tenant or EQ gains the Field safety surface — confirm the caller first. |
| `sks_gm_briefing_reshape_expand.sql` | ehowg | 🔒🔒 | 🟡 staged (parity, safe) | PHASE 1: add `tenant_id` (nullable) + backfill + per-tenant index. Additive, invisible to the app. |
| `sks_gm_briefing_reshape_contract.sql` | ehowg | 🔒🔒 | 🟡 staged — **deploy-coupled** | PHASE 2: enforce NOT NULL + swap the period unique key. Ship the `upload-gm-report.ts` change first (documented in the file). |

| `sks_intake_vestige_tables_drop.sql` | ehowg | 🔒 | 🟡 staged — safe, no data loss | Drop 4 leftover `eq_intake_*` tables (shell_control + app_data) from pre-silo era. All empty except `eq_intake_events` (5 rolled-back smoke-test rows, snapshotted in file). RPCs already dropped by `0027`. |

## Not authored here (specced in FINAL-SPRINT Phase 3, need the drift work-list + smoke)

- **SKS Service CMMS reconcile** — converge the older `ppm_*` path onto the branch `0020`/`0021` shape; drive off `check-tenant-drift.mjs` once the runner has produced the diff.
