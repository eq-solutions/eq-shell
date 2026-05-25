# EQ Overnight Sprint Report — 2026-05-25

---

## ⚠️ SECURITY FINDINGS (read first)

### CRITICAL — 13 SECURITY DEFINER functions callable by unauthenticated callers

**Migration applied:** `2026_05_25e_revoke_anon_security_definer`

PostgreSQL's default is to grant EXECUTE to PUBLIC on new functions. All 13 of our
`SECURITY DEFINER` functions in `public.*` were missing an explicit REVOKE, meaning
anyone with the Supabase anon key (publicly available in CSP headers) could call them.

**Most severe:** `clear_rate_limit(text)` had zero internal auth guard. An attacker
could call it by key name and clear the rate-limit bucket for any IP — bypassing PIN
brute-force protection entirely.

**Fixed:** REVOKE'd from PUBLIC + anon for all 13 affected functions. GRANT to
`authenticated` + `service_role` only. Applied to `jvknxcmbtrfnxfrwfimn` at
2026-05-25 02:00 UTC.

Functions fixed: `clear_rate_limit`, `eq_get_tenant_user`, `eq_intake_event_rows`,
`eq_is_session_revoked`, `eq_list_module_entities`, `eq_list_tenant_users`,
`eq_provision_tenant_bucket`, `eq_recent_intake_events`, `eq_recent_mint_audit`,
`eq_record_mint`, `eq_revoke_session`, `eq_write_audit_log`, `set_pin`.

Functions deliberately kept for anon (login + RLS flow): `has_pin`, `verify_pin`,
`check_and_increment_rate_limit`, `link_pending_invites`, `lock_invite_accept_columns`,
`log_licence_change`, `log_membership_change`, `log_profile_change`,
`is_org_admin`, `is_org_admin_of`.

---

## Phase 1 — eq-canonical (Supabase DB)

**Status: Complete**

| Task | Result |
|---|---|
| Security advisors | INFO only — no ERROR/WARN. RLS-no-policy notices on shell_control tables are by design (service-role only via SECURITY DEFINER) |
| Site count | No sites/locations table in shell_control — confirmed. Sites live in per-tenant Supabase. The `0` stub in `eq_tenant_dashboard_counts` is correct and now documented with a SQL comment (migration `2026_05_25f`) |
| RPC verification | All 7 public RPCs execute without error: `eq_tenant_dashboard_counts`, `eq_recent_intake_events`, `eq_recent_auth_events`, `eq_recent_mint_audit`, `eq_intake_event_rows`, `eq_intake_rollback`, `eq_record_mint` |
| SECURITY DEFINER grants | Fixed — see above |

**Migrations written to disk** (previously applied but not committed):

| File | Purpose |
|---|---|
| `2026_05_25b_missing_public_rpcs.sql` | Public wrappers for dashboard counts + auth events |
| `2026_05_25c_auth_hook_full_claims.sql` | Auth hook stamps eq_role + is_platform_admin — shell_control.users is single source of truth |
| `2026_05_25d_data_cleanup.sql` | Remove stale tender_pipeline entitlement; promote royce@eq.solutions |
| `2026_05_25e_revoke_anon_security_definer.sql` | **SECURITY** — revoke anon execute on 13 functions |
| `2026_05_25f_dashboard_counts_site_comment.sql` | Document site count stub |

---

## Phase 2 — eq-shell

**Status: Complete. PR opened.**
**PR:** [eq-solutions/eq-shell#50](https://github.com/eq-solutions/eq-shell/pull/50)

| Task | Result |
|---|---|
| TenantHome RPCs | Working correctly — staff count, intake events, site count all handle null/empty/error states |
| AdminAuditPage | All 3 tabs (auth, intakes, mints) wired correctly. Drilldown and rollback look correct |
| AdminUserList / AdminEditUser | Pages reviewed — working. Fixed copy: "role changes take effect on next **page load**", not "next login" (verify-shell-session reads shell_control live on every call) |
| FieldIframe timeout | Fixed: timeout message said "10 seconds" but `HANDOFF_TIMEOUT_MS = 30_000`. Both Sentry message and user-facing copy corrected |
| ServiceIframe | eq-solves-service deploy status: **ready** (live). 45s timeout is appropriate for Next.js SSR + OTP round-trip |
| Observability | Code is correct (all 3 SDKs no-op gracefully on missing vars). **Cannot verify env vars via MCP** — check manually in Netlify dashboard → eq-shell site → Environment variables |
| Build | `pnpm run build` passed clean — no TypeScript errors |

**Needs manual check (Netlify dashboard):**
- `VITE_SENTRY_DSN` — Sentry org `eq-solutions`, project `eq-shell`
- `VITE_POSTHOG_KEY` — PostHog project API key
- `VITE_CLARITY_PROJECT_ID` — Microsoft Clarity project ID

---

## Phase 3 — eq-cards

**Status: Complete. PR opened.**
**PR:** [Milmlow/eq-cards#9](https://github.com/Milmlow/eq-cards/pull/9)

| Task | Result |
|---|---|
| Handoff edge cases | Missing hash → email OTP (correct). Malformed hash → error shown. Expired JWT → **was leaking raw exception text to user** (see fix below) |
| Exception leakage fix | `IframeHandoffScreen` was showing `e.toString()` on `setSession` failure — exposed auth system internals (JWT format, "token expired" etc). Fixed: generic message shown, exception captured in Sentry with stack trace |
| Hardcoded secrets | None in `lib/`. All via `--dart-define`. One hardcoded domain: `'https://cards.eq.solutions'` as Google OAuth redirect in `auth_repository.dart` (low risk, correct for prod) |
| /auth/handoff exclusion | Correctly excluded from sign-in redirect in `app_router.dart` line 222 |
| CSP | Correct — `frame-ancestors 'self' https://*.eq.solutions` allows Shell embed. `'unsafe-inline'`/`'unsafe-eval'` are required by Flutter CanvasKit |
| `flutter analyze` | Clean after import ordering fix |

---

## Phase 4 — eq-solves-field

**Status: Complete. PR opened. Requires deploy to take effect.**
**PR:** [eq-solutions/eq-field#133](https://github.com/eq-solutions/eq-field/pull/133)

**Root cause of Field iframe timeout:**

Shell's 30s timeout was firing because:
1. `window.onload` fires (after page + SW install)
2. `await loadTenantConfig()` — **two sequential Supabase round-trips** (org config + app_config)
3. ONLY THEN does `checkAccess()` run → `_consumeShellToken()` → `boot` postMessage

On cold start, steps 1–3 can take 2–10s. By the time `boot` fires, Shell's timer has consumed most of its budget. On slower connections or a cold Netlify function, the remaining time may not be enough.

**Fix:** Added an early `boot` signal from `window.onload` before `loadTenantConfig`, checked by looking for `#sh=` in the hash. Shell receives confirmation "I'm alive" within ~1s of iframe load. The later `boot` from `_consumeShellToken` is redundant but harmless.

**⚠️ Needs deploy** — the fix is in `index.html` which requires a Netlify deploy to go live.

---

## Phase 5 — eq-quotes (read-only trawl)

**Status: Complete. One GitHub issue opened. No code changes made.**

| Finding | Severity | Action |
|---|---|---|
| `.env` has real service role JWT | N/A | Gitignored (correct) — local only, not in remote |
| `TestConfig` in `app/config.py` has hardcoded `SECRET_KEY = "test-key"` | LOW | [Issue #3](https://github.com/eq-solutions/eq-quotes/issues/3) opened |
| `ProductionConfig` doesn't fail-fast on missing `FLASK_SECRET_KEY` | LOW | Included in issue #3 |
| SQL injection | ✓ None | All queries use parameterized Supabase API builders |
| Auth guards | ✓ In place | Sensitive routes (generate, email, integrations) gated by `@login_required` / `@estimator_selected` |
| XSS | ✓ None found | `render_template_string` usage passes controlled values only |
| Money handling | ✓ Correct | Decimal arithmetic throughout, no float leakage |

---

## PRs opened

| Repo | PR | Branch |
|---|---|---|
| eq-solutions/eq-shell | [#50](https://github.com/eq-solutions/eq-shell/pull/50) | `feature/overnight-sprint-shell` |
| eq-solutions/eq-field | [#133](https://github.com/eq-solutions/eq-field/pull/133) | `feature/overnight-sprint-field` |
| Milmlow/eq-cards | [#9](https://github.com/Milmlow/eq-cards/pull/9) | `feature/overnight-sprint-cards` |

---

## DB migrations applied

All applied to `jvknxcmbtrfnxfrwfimn` (eq-canonical). Files now on `feature/overnight-sprint-shell`.

| Migration | Applied | Summary |
|---|---|---|
| `2026_05_25b_missing_public_rpcs` | 2026-05-25 | Public RPC wrappers |
| `2026_05_25c_auth_hook_full_claims` | 2026-05-25 | Auth hook stamps eq_role + is_platform_admin |
| `2026_05_25d_data_cleanup` | 2026-05-25 | Remove tender_pipeline entitlement; promote royce@eq.solutions |
| `2026_05_25e_revoke_anon_security_definer` | 2026-05-25 | **SECURITY** — 13 SECURITY DEFINER function grants fixed |
| `2026_05_25f_dashboard_counts_site_comment` | 2026-05-25 | Document site count stub |

---

## Items requiring Royce input

1. **Deploy eq-solves-field PR #133** — Field iframe timeout fix won't take effect until the branch is deployed to Netlify.

2. **Verify Netlify observability env vars on eq-shell** — Can't check via MCP. In Netlify dashboard → eq-shell site → Environment variables, confirm `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_CLARITY_PROJECT_ID` are set.

3. **Confirm Supabase auth hook remains enabled** — Dashboard → eq-canonical → Authentication → Hooks → Custom Access Token → `public.custom_access_token_hook`. This is load-bearing for JWT claims.

4. **eq-cards Netlify CI auto-deploy** — STATUS.md notes the GitHub→Netlify build wiring is not yet set up. Manual deploys required until wired.

5. **eq-cards Supabase Email OTP** — STATUS.md notes to verify: Dashboard → eq-canonical → Auth → Email → "Enable Email OTP" = ON, expiry = 3600s. If in magic link mode the OTP screen will always fail.

6. **Review and merge PRs** — All 3 PRs are ready for review. eq-shell and eq-cards can merge when tested. eq-field requires deploy after merge.
