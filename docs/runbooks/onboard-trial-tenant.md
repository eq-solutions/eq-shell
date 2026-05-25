# Onboard a trial tenant

End-to-end runbook for getting a brand-new trial customer from "I want to try this" to "I'm signed in and using it" in one command.

**Time:** ~5 minutes total (3 min waiting for Supabase project + 2 min for migrations + scripted control-plane writes).

**Pre-Phase A method:** ~5 manual SQL queries + dashboard clicks. This runbook replaces that.

---

## Prerequisites (one-time setup)

You need a local `.env` (do not check in) with these vars. Most are already in your Netlify dashboard for eq-shell — copy them:

```bash
# Supabase Management API — for creating a new per-tenant project.
SUPABASE_ACCESS_TOKEN=sbp_xxx              # https://supabase.com/dashboard/account/tokens
SUPABASE_ORG_ID=sqjyblkiqonyrdobaucn       # EQ Solutions org id
SUPABASE_DB_PASSWORD=<strong-random>       # set once + reuse across new projects

# Control plane (shared eq-canonical) — for the tenant_routing INSERT and entitlements
CONTROL_SUPABASE_URL=https://jvknxcmbtrfnxfrwfimn.supabase.co
CONTROL_SUPABASE_SERVICE_KEY=<service-role-key-from-eq-canonical>

# Master encryption key for service-role storage in tenant_routing.
TENANT_ROUTING_MASTER_KEY=<32-byte-hex>    # same value set on eq-shell Netlify env

# Optional: override the shell base URL (default https://core.eq.solutions)
# SHELL_BASE_URL=https://deploy-preview-N--eq-shell.netlify.app
```

Load it: `export $(grep -v '^#' .env | xargs)` (bash) or `dotenv -e .env -- ...` (cross-platform).

---

## The one command

```bash
node scripts/onboard-trial-tenant.mjs \
  --slug=acme \
  --name="Acme Electrical" \
  --admin-email=jane@acme.com \
  --admin-name="Jane Smith" \
  --tier=trial \
  --modules=cards,intake,field
```

### Flags

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--slug` | yes | — | Lowercase kebab, 2-31 chars, starts with a letter. Becomes the URL path: `core.eq.solutions/<slug>`. |
| `--name` | yes | — | Display name shown in Shell topbar + welcome page. |
| `--admin-email` | yes | — | First admin's email — receives the invite. Becomes a `manager` role user. |
| `--admin-name` | no | `""` | Used in the printed welcome blurb only. |
| `--tier` | no | `trial` | One of: `trial`, `standard`, `advanced`, `enterprise`. Affects which modules are visible (trial hides Quotes and Service). |
| `--modules` | no | `cards,intake,field` | Comma-separated. Allowed: `cards`, `intake`, `field`, `service`, `quotes`. |
| `--region` | no | `ap-southeast-2` | Supabase region for the new tenant DB. |
| `--skip-provision` | no | false | Skip Step 1 — use only when re-running against an already-provisioned tenant. |
| `--skip-migrate` | no | false | Skip Step 2 — use when only updating entitlements / re-issuing an invite. |

---

## What happens (5 steps)

1. **Provision Supabase project** (~2-3 min) — creates a fresh per-tenant Supabase, polls until `ACTIVE_HEALTHY`, encrypts the service-role key with `TENANT_ROUTING_MASTER_KEY`, writes a `tenant_routing` row with `status='provisioning'`.
2. **Apply per-tenant schema migrations** (~30s) — runs every file in `supabase/tenant-migrations/*.sql` against the new project. Idempotent.
3. **Activate the tenant** — flips `tenant_routing.status` to `active` and sets `shell_control.tenants.tier` if it changed.
4. **Seed `module_entitlements`** — inserts an `enabled=true` row for each `--modules` value.
5. **Create admin invite** — generates a random token, stores its SHA-256 hash in `user_invites`, prints the raw token in the invite URL.

---

## Expected output (last block)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ONBOARDING COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Tenant slug:    acme
 Tenant name:    Acme Electrical
 Tenant URL:     https://core.eq.solutions/acme
 Admin email:    jane@acme.com
 Invite URL:     https://core.eq.solutions/accept-invite?token=<64-hex>
 Invite expires: 2026-06-01T05:23:11.000Z  (168h from now)

 Paste-into-email template:
   …
```

Copy the **Invite URL** and email it to the admin. Until the email pipeline (Phase A7 — Resend wiring) lands, this paste-into-email is your only delivery method.

---

## Post-flow verification (~2 min)

1. **Health check** — `curl -s https://core.eq.solutions/.netlify/functions/tenant-routing-health -H "Cookie: eq_shell_session=<your-platform-admin-session>"`. The new slug should appear with `reachable: true` and `table_counts` for the migrations that were applied.
2. **Open the invite URL in an incognito window.** You should land on a PIN-set page. Set a PIN. You should be signed in and land on `/acme`.
3. **Check the modules.** Only the modules you passed in `--modules` should be visible in the topbar + Hub tiles.
4. **Sign in as platform admin (you) in your normal browser**, navigate to `/acme/admin/users`, confirm the new admin user is listed with role `manager`.

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `ERROR: Missing env vars: TENANT_ROUTING_MASTER_KEY` | Forgot to source `.env` | `export $(grep -v '^#' .env \| xargs)` then re-run |
| Step 1 hangs past 10 min | Supabase Management API rate limit or stuck provisioning | Check Supabase dashboard for the project; if stuck, delete it there and re-run |
| Step 2 fails with `relation app_data.foo does not exist` | A migration depends on a previous one that wasn't applied | Re-run with `--skip-provision` only; migrate-tenants.mjs is idempotent |
| Step 3 fails: `tenant lookup failed: no row` | Step 1 was skipped but the tenant slug doesn't exist yet | Either run without `--skip-provision`, or insert the tenants row manually |
| Step 5 inserts a duplicate invite | Re-running on the same tenant. There's no unique constraint on (tenant_id, email) for pending invites. | Acceptable — the latest invite token wins; older tokens still work until expiry |
| Admin opens invite URL, gets "invite-not-found-or-expired" | The 7-day TTL expired, OR the invite has already been accepted | Re-run with `--skip-provision --skip-migrate` to issue a fresh invite |
| Modules don't appear after sign-in | Entitlement seeded but session not refreshed | Sign out + back in. The session caches entitlements at login time. |

---

## Off-boarding (when a trial ends)

Currently manual. A `scripts/deprovision-tenant.mjs` is on the Phase C backlog. For now:

1. **Soft delete**: `UPDATE shell_control.tenants SET active=false WHERE slug='<slug>';` — blocks all sign-ins immediately.
2. **Hard delete** (after data retention window): delete the Supabase project via dashboard, then `DELETE FROM shell_control.tenant_routing WHERE tenant_id=...; DELETE FROM shell_control.tenants WHERE id=...;`.
3. **Don't reuse the slug** for a different customer — old `tenant-<uuid>` storage buckets may still hold their objects.

---

## Related

- [ARCHITECTURE-V2.md](../ARCHITECTURE-V2.md) — full per-tenant data-plane background.
- [scripts/provision-tenant.mjs](../../scripts/provision-tenant.mjs) — Step 1's underlying script.
- [scripts/migrate-tenants.mjs](../../scripts/migrate-tenants.mjs) — Step 2's underlying script.
- [SECURITY-PATTERNS.md](../../SECURITY-PATTERNS.md) — standards every new EQ app inherits.
