# Staged migrations — gated, NOT auto-applied

These SQL files are **ready to run but deliberately not applied** — each touches a
surface behind a sign-off gate (control plane, live-SKS data, or the Quotes silo).
They live here, **outside `tenant-migrations/`**, so the migrate-tenants runner never
picks them up automatically. Apply each by hand (Supabase MCP `apply_migration` or the
SQL editor) once its gate clears.

Source review: [`docs/FINAL-SPRINT.md`](../../docs/FINAL-SPRINT.md) — Phases 2–3.

| File | Target | Gate | What / why |
|---|---|---|---|
| `jvkn_auth_rpc_hardening.sql` | **jvkn** (control plane) | 🔒 auth — Royce sign-off | Revoke `anon`/`authenticated` EXECUTE on 3 admin PIN primitives that take an arbitrary `user_id` with no caller check. Only `cards-api.ts` (service-role) calls them. Closes a latent account-takeover / PIN-brute-force / user-enumeration surface. |
| `sks_overlay_fn_revoke.sql` | **ehowg** (live SKS) | 🔒 Track-B-adjacent | Revoke `anon`/`authenticated` EXECUTE on the 5 `_sks_*` overlay trigger fns. They're `RETURNS trigger` (error if RPC-called) and fire as triggers regardless of grant, so this is safe + does not affect Quotes (service-role). |
| `sks_safety_rpc_hardening.sql` | **ehowg** (live SKS) | 🔒🔒 needs Field-caller check | `approve_safety_record`/`submit_safety_record` trust a caller-supplied `p_tenant_id` and are `authenticated`-executable → latent cross-tenant write. Two fix options inside; pick based on how EQ Field calls them. |

## Not yet authored here (specced in FINAL-SPRINT Phase 3, need design + smoke)

- **gm/briefing `tenant_id` reshape** (SKS) — ADD `tenant_id` + backfill `7dee117c` + swap UNIQUE; must ship **with** `upload-gm-report.ts` (`onConflict: 'tenant_id,period_code'`). Deploy-coupled.
- **SKS Service CMMS reconcile** — converge the older `ppm_*` path onto the branch `0020`/`0021` shape; drive off `check-tenant-drift.mjs`.
