# Shell → Service identity (verified state + isolation hardening)

Verified against live DBs 2026-06-04 (eq-canonical `jvkn`, Service `urjhmkhbgaxrofurpbgc`).

> **Update 2026-06-22:** the Service project `urjhmkhbgaxrofurpbgc` (urjh) was **deleted**. EQ Service now runs on **ehow** (`ehowgjardagevnrluult`). Read any `urjhmkhbgaxrofurpbgc` reference below as historical.

## What's actually true (live)

The original "no `tenant_members` row → login bounce" diagnosis was **stale**. Live:

- `royce@eq.solutions` is **core-only** in the Shell (`is_platform_admin=true`), and
  **already has an active Service membership** in the `eq` tenant ("EQ Solutions",
  `eb9a6a43`), and has signed into Service. The bounce was the transient
  pre-provisioning state and is resolved.
- `royce.milmlow@sks.com.au` → Service `sks` tenant (`ccca00fc`). Separate identity.

So **tenants are already cleanly separated**: the core login resolves to the `eq`
Service tenant, the SKS login to the `sks` Service tenant. `core` is never mapped to
SKS.

**Slug note for any future bridge work:** the Shell tenant slug ≠ the Service tenant
slug. Shell `core` ↔ Service `eq`; Shell `demo-trades` ↔ Service `demo-electrical`.
`shell_control.tenants.field_tenant_slug` maps Shell→Field and is **not** a reliable
Shell→Service map. A Shell→Service mapping would need its own column/lookup — do not
assume slug equality.

## What this change does (the only thing needed here)

`netlify/functions/token-exchange.ts` (`aud='service'`): mint the Service JWT with
`is_platform_admin: false`.

Rationale (Royce directive: no cross-tenant, ever): Service maps
`is_platform_admin → super_admin`, and Service RLS `is_super_admin()` grants
**cross-tenant** visibility across every tenant. A bridged Service identity must
never carry platform-admin, so it can never escalate to Service super_admin — it
gets only its own tenant's mapped role. Latent today (no bridge path provisions a
super_admin row), this bakes the guarantee in before any provisioning path goes live.
Field is unchanged — it has no such escalation.

## Tenant-isolation audit (2026-06-04)

eq-shell isolation is strong and layered: data-plane functions pin tenant from the
verified session (never client input); tenant switching is membership-gated
(`select-tenant`/`switch-tenant` → `403 not-a-member`); cross-tenant capability is
`is_platform_admin`-gated; RLS reads `app_metadata.tenant_id`; tenant-routing keys
are AES-256-GCM encrypted. No live cross-tenant leak.

## Separate follow-up (not this PR)

Opening the `eq` Service tenant lands on Service's onboarding/setup page asking for
company info that already exists in the tenant canonical. Service onboarding should
hydrate company details from canonical rather than re-prompt. eq-solves-service
concern; tracked separately.
