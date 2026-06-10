# Phase B Brief — Tier Framework (Billing + Starter Ship)

**Status:** Draft, pre-code. Phase A still on open PR #82. This prep PR
stacks on #82 to land the mobile chip + this doc. Phase B branches off
the resulting baseline.

**Scope locked:** 2026-05-13 (decision pass after the previous session's
morning-brief was lost — see `project_tier_framework_phase_b.md` in
auto-memory for the four locked-in decisions).

---

## Recap — Phase A (PR #82)

- `tenants.tier` (`starter | team | enterprise`) + `tenants.compliance_tier`
  (`standard | enhanced | enterprise`). Default `team / standard`.
- `public.tenant_tier_view` (security_invoker) feeds the chip's single fetch.
- `TenantTierChip` — desktop fixed top-right; **mobile variant now wired in
  this prep PR**.
- `TIER_DESCRIPTIONS` constants inside the chip define each tier's pitch +
  4–5 included features. De-facto product definition until SCALING-TIERS doc
  is rewritten.
- **No enforcement.** Nothing in the app blocks on tier. `/admin/billing`
  still 404s.

PR #82 self-defers Phase B: *"No /admin/billing (stays 404 until Phase B).
No Stripe wiring (deferred to Phase B+ when pricing lands)."*

---

## Phase B — locked scope

### 1. Self-serve Starter signup

- New public route `/signup` — email + password + tenant name +
  (optional) company.
- On submit: create `auth.users` row + `tenants` row with `tier='starter'`
  + `tenant_members` row with `role='admin'` + welcome email.
- No invite needed. No payment up-front (rails not enforced).
- Marketing copy / landing page is out of scope — just the form.

### 2. Stripe rails (no live prices)

- `tenants.stripe_customer_id` (nullable). Populated lazily on first
  `/admin/billing` visit or first checkout attempt.
- Webhook receiver — Netlify function (default) for
  `customer.subscription.{created,updated,deleted}`. Idempotent. Flips
  `tenants.tier` accordingly.
- Price IDs sit in env: `STRIPE_PRICE_TEAM_MONTHLY`,
  `STRIPE_PRICE_ENTERPRISE_MONTHLY`, etc. Empty in `.env.example`.
  Production stays unset until pricing is live → "upgrade" buttons
  disabled-with-tooltip when env unset.

### 3. `/admin/billing` page

- Admin / super_admin only (matches existing `/admin/*` gate).
- Shows: current tier + compliance tier, usage gauges
  (customers / sites / assets vs Starter and Team limits), Stripe
  customer status, upgrade CTAs (disabled if price env unset).
- Mailto "Contact sales" escape hatch remains.

### 4. Soft usage warnings

- Helper `getTenantUsage(tenantId)` returns counts of
  customers / sites / assets.
- Surfaces on `/admin/billing` as green/amber/red gauges.
- **No gates anywhere** — Starter tenants can exceed limits, just see
  warnings. Hard gates = Phase C.
- Audit log entry on every tier change (Stripe webhook → admin can see
  the source of the flip).

---

## Open questions — defer until coding starts

1. **Webhook host:** Netlify function (in-repo) vs Supabase edge function.
   Netlify keeps secrets co-located; Supabase edge has lower cold-start.
   **Default: Netlify.**
2. **Email verification for Starter signup:** on/off. Supabase default is on.
   **Default: on** (free abuse protection).
3. **Sample data for new Starter tenants:** empty vs seeded 1-of-each.
   **Default: empty** (user adds their first themselves).
4. **Compliance tier UI:** still tenant-level only, no UI to change it
   (Jemena-pattern → manual UPDATE). Phase B leaves it alone.
5. **Tier downgrade policy:** what happens if a tenant with 60 sites on
   Team downgrades to Starter? Phase B = soft warnings only, so nothing.
   Phase C (gating) will need a freeze-or-archive policy.

---

## What this brief deliberately does **not** include

- Pricing decisions (parked separately).
- Hard gates / enforcement (deferred to Phase C).
- Multi-tenant parent/child (Enterprise tier feature, separate work).
- SSO / SAML / API / SOC 2 — Enterprise items, not Starter-ship.
- White-label theme work beyond what tenants already get.

---

## Sequence

```
PR #82 (open) ─┬─→ this prep PR ─→ Phase B PR ─→ Phase C (gating + pricing)
               │   ├─ mobile chip
               │   └─ this brief doc
               │
               └─ merges to main first
```

Phase B branches off this prep PR's HEAD only after PR #82 has merged to
main. Avoid stacking three deep.
