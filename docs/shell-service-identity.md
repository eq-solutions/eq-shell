# Shell → Service identity (token-mode provisioning)

Status: **Shell half only.** Prod behaviour is unchanged until the Service-side
counterpart ships and the embed is switched to token mode. Diagnosed 2026-06-04.

## The bug

Opening the EQ Service tile inside `core.eq.solutions` shows Service's own login
page instead of auto-authenticating.

## Root cause (verified in code, not assumed)

The Shell→Service bridge faithfully authenticates the **email** it is handed, but
no bridge path ever creates the `tenant_members` row Service needs to grant tenant
access. Each path is missing one required input:

- **JWT / token-exchange path** carries the role but **no `tenant_slug`** →
  Service's `shell-auth` skips the upsert (`app/api/shell-auth/route.ts`, the
  `if (tenantSlug)` block).
- **Bridge-token path** carries `tenant_slug` but **no role claims** →
  `serviceRole` is null → the whole `if (userId && serviceRole)` upsert block is
  skipped.
- **Cookie fast-path** (`proxy.ts`) only does `generateLink(email)` + `verifyOtp`
  — it never touches `tenant_members` at all.

So a user with no Service membership for the active tenant authenticates, gets a
`profiles` row, and then lands with **no tenant** → the login bounce. This is the
system failing **closed** — no data crosses tenants.

## Tenant-isolation audit (2026-06-04)

eq-shell isolation is strong and layered: data-plane functions pin tenant from the
verified session (never client input); tenant switching is membership-gated
(`select-tenant.ts` / `switch-tenant.ts` → `403 not-a-member`); cross-tenant
capability is `is_platform_admin`-gated; RLS reads `app_metadata.tenant_id`;
tenant-routing keys are AES-256-GCM encrypted. No live cross-tenant leak found.

**One latent risk closed by this change:** Service maps `is_platform_admin →
super_admin`, and Service RLS `is_super_admin()` grants **cross-tenant** visibility.
Dormant today (no bridge path provisions a super_admin row), but it would activate
the moment provisioning is wired. See the guarantee below.

## What this PR changes (Shell side)

`netlify/functions/token-exchange.ts` (`aud='service'`) and
`_shared/supabase-jwt.ts`:

1. **Carry the verified active-tenant slug** in the Service JWT
   (`app_metadata.tenant_slug`) and the response body. The slug is resolved from
   `user.tenant_id`, which the existing guard pins to `session.tenant_id` — it can
   only ever name the tenant the user is actually in. Never client-supplied.
2. **Hard-disable platform-admin on the Service JWT** (`is_platform_admin: false`
   for `aud='service'`). A bridged Service identity can therefore never be mapped
   to `super_admin`. Users get only their own tenant's mapped role. Field is
   untouched.

Additive and inert in prod: cookie mode is still active and Service ignores the new
field until its counterpart ships. No embed-mode flip in this PR.

## Service-side counterpart required (separate, coordinated PR)

In `eq-solves-service`:

- `app/api/shell-auth/route.ts` JWT path: read `app_metadata.tenant_slug`, look up
  the Service tenant by slug, and run the **same `tenant_members` upsert** the
  bridge-token path already uses — with the mapped role. **Keep the `super_admin`
  mapping unreachable from bridged JWTs** (this PR enforces that from the Shell side
  by sending `is_platform_admin: false`; the Service side should not re-derive it).
- A Service tenant must exist whose slug matches the Shell active tenant. A user is
  only ever provisioned into the tenant named by their own verified slug.

## To activate

1. Ship the Service-side counterpart above.
2. Ensure a slug-matched Service tenant exists for each Shell tenant that should see
   Service.
3. Switch `ServiceIframe` to token mode (today it uses cookie mode when
   `VITE_SERVICE_URL=https://service.eq.solutions`).

## Open decision (Royce)

What should `/core/service` resolve to for the EQ Solutions (`core`) session — an
EQ Solutions Service tenant (likely empty), or no Service tile for `core` at all?
**Keeping tenants separate, `core` is never silently mapped to SKS.** Pending this
decision, `/core/service` correctly shows the no-membership state.
