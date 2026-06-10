# User journey — beginner to advanced

Date: 2026-05-19. Status: draft, pre-decision. Synthesises prior fragmentary work into one canonical reference for how an EQ Service user matures over time.

## Why this doc exists

The concept of a beginner→advanced user progression has come up multiple times across the EQ ecosystem and never been fully captured:

- **2026-05-?? — EQ Field mobile-first nav proposal** ([`_proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md`](../../C:/Projects/eq-solves-field/_proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md)). Royce's own line under "What we are NOT doing in this release": *"User-selectable Basic / Standard / Advanced mode toggle. Not yet. Wait until someone asks."* — the concept was raised and deferred.
- **2026-05-18 — UX audit** (PR #149). Persona-annotated friction findings across brand-new tech / experienced tech / apprentice. First time the persona axis got systematic treatment in EQ Service.
- **2026-05-19 — TechDashboard + /do page** (PR #156 + #157). First concrete role-aware surfaces in EQ Service that demote admin scaffolding for daily-use users.

This doc unifies those threads into a model that future PRs can be evaluated against. **What it is not:** a settled product spec. The shape is right; the details want a Royce-pass before code lands.

## TL;DR — the four stages

We model user maturity as four stages, named after what the user is *doing* (not their role):

| Stage | Common name | Time horizon | Hot path |
|---|---|---|---|
| 1 | **First-day user** | Day 0–1 | Find work that's already been set up for them |
| 2 | **Doing the work** | Week 1 | Execute on assigned work with one tap per item |
| 3 | **Owning the surface** | Month 1 | Bulk-action, customise, search across the tenant |
| 4 | **Driving the system** | Quarter 1+ | Configure, integrate, set policy |

Stages cut **across** roles. A technician can be at stage 2 forever (and that's fine). An admin starting a fresh tenant is at stage 1 even if they've used other CMMSes. Time horizon is a rough guide; the actual signal is the **behaviours** in the next section.

The progression is not strictly linear — most users sit at stage 2 long-term, and that's the design target. Stage 4 is for power-users (Royce, SKS supervisors, future Jemena admins running their own onboarding).

## What each stage looks like

### Stage 1 — First-day user

**Mental state:** "Where am I, what do I do, what is this?"

**Behaviours:**
- Signs in for the first time
- Reads every label before clicking
- Doesn't know which routes exist
- Doesn't trust their own actions yet (worries about breaking things)
- Hits permission errors blind (no idea why a button is disabled)

**Surfaces that serve them:**
- **`/do`** (PR #157) — landing-page launcher with intent-based tiles. Removes the "which page do I go to?" question.
- **Empty-state CTAs** on every list — "Create your first customer" style. Already on most lists.
- **`SetupChecklist`** (admins on empty tenants) — explicit progress + locked steps that prevent dead ends.
- **`TechDashboard`** (PR #156) — for techs, "My Upcoming Works" first; no entity KPI tiles to distract.
- **Inline disabled-reason text** (PR #156) — "3 required tasks remaining" replaces invisible hover tooltip.

**Signals they're ready for stage 2:**
- They've completed one assigned check (tech) or scheduled one check (admin)
- They navigate via the sidebar without re-checking labels
- They've raised a defect at least once

**Gaps today:**
- No first-login welcome card (PR I scope, deferred)
- No in-app tour / coach marks
- `/do` is a launcher; doesn't teach what the tiles produce

### Stage 2 — Doing the work

**Mental state:** "I know my route. Get out of my way."

**Behaviours:**
- Daily user, not session-by-session deliberate
- Wants minimum chrome between sign-in and the first action
- Hits one or two surfaces 90% of the time (Maintenance + a specific test type for techs; Records + Maintenance for admins)
- Uses inline editing, keyboard, the assigned-to-me filter
- Reports things they don't like — "why are there three buttons to do X?"

**Surfaces that serve them:**
- **Mine / All toggle on `/maintenance`** (PR #156). Default Mine for techs.
- **Sidebar role-trim** (PR #156) — techs don't see Records or Insight.
- **44px tap targets** (PR #158) — works in gloves, in a server room, on a phone.
- **Kind-aware tagline on `/maintenance/[id]`** (PR #160) — pre-empts the asset-table vs linked-tests split.
- **Demoted Customer Report for techs on complete checks** (PR #160) — "Back to my checks" is the primary CTA.
- **Smart defaults from URL context** (PR D, building) — `/sites?customer_id=X` pre-fills the form when they click Add.
- **Print run-sheet** — for techs going to a no-signal switchroom.

**Signals they're ready for stage 3:**
- They use bulk actions ("Complete All Assets", batch-select)
- They use the URL bar directly (typing `/maintenance?status=overdue`)
- They edit data on rows they didn't create

**Gaps today:**
- **No keyboard shortcuts** for any action
- **No saved filters** — every page-load reapplies the same filter manually
- **No "next assigned check" link** on a completed check (only "Back to my checks") — minor disruption between consecutive checks
- **No PWA / offline queue** — competitive-audit top-3 gap; major loss when network drops mid-save

### Stage 3 — Owning the surface

**Mental state:** "I run this. Make it efficient."

**Behaviours:**
- Configures their own work: filters, defaults, what they look at when
- Uses bulk operations regularly (xlsx import, multi-select complete, batch defect-raise)
- Customises views (sort order, column visibility, default site)
- Onboards other users — explains the app to a new starter
- Sees patterns across data the system doesn't auto-surface

**Surfaces that serve them:**
- **Excel / xlsx import flows** — Equinix Delta WO, Jemena RCD multi-tab. Bulk-creation existed before /do but was scattered.
- **Customer-scoped + global job plans** — power-user level of asset configuration.
- **Report customisation** — `/admin/reports` controls cover / sections / sign-off fields.
- **Audit log** — read-back to verify "did that change land?"
- **Calendar view** — see ahead, plan resourcing.
- **Saved search / filter URL bookmarks** — they bookmark `/maintenance?view=mine&status=overdue` and `/defects?severity=critical`.

**Signals they're ready for stage 4:**
- They write SOPs for their team
- They request integrations ("can this hit Xero?")
- They want to grant access / set up new tenants
- They've found bugs and reported them precisely

**Gaps today:**
- **No saved views** in any list page (every filter resets per visit)
- **No per-user preferences** (theme, default page, notification settings — partially present in `/settings`)
- **No scheduling-dispatch board** — competitive-audit top-3 gap; supervisor-level need
- **No keyboard shortcuts at all** — significant friction for power users

### Stage 4 — Driving the system

**Mental state:** "What does this do, exactly? Can we automate it?"

**Behaviours:**
- Owns tenant configuration (tier, billing, integrations)
- Approves auth changes (MFA policy, SSO)
- Sets compliance posture (audit log retention, defect SLAs)
- Drives feature requests with concrete proposals
- Operates across tenants if they're a partner / multi-customer

**Surfaces that serve them:**
- **`/admin/*` block** — users, settings, reports template, billing, archive, audit logs.
- **Tier framework** — Starter / Team / Enterprise differentiation.
- **`/api/*` endpoints** for direct integration (currently report exports only).
- **Module entitlements** — which EQ modules this tenant has (post EQ Shell consolidation).
- **MCP integration** — Sentry, Supabase MCPs for ops introspection.

**Surfaces NOT here that would matter for stage 4:**
- **Bulk user CSV invite** — currently one-by-one in `InviteUserForm`
- **Tenant settings export / import** — for replicating a known-good config to a new tenant
- **API key management UI** — currently env-var only
- **EQ Shell canonical tie-in** (Task #8 — separate doc)

## Cross-stage design rules

Decisions that hold regardless of which stage we're optimising for:

1. **Never break a stage-1 user with a stage-3 affordance.** Power-user shortcuts (keyboard, URL params) should be additive, not surface-replacing. A first-day user must still find the GUI button.
2. **A stage's hot path stays one tap away.** Stage 2's "find my check → tap pass/fail" remains the dominant interaction, regardless of what stages 3 / 4 layer on top.
3. **Surface configuration where the data lives, not in a separate settings hub.** Per-user preferences attach to the surface they affect (default filter on `/maintenance`, not in `/settings`).
4. **Role-aware ≠ feature-flagged.** TechDashboard and the sidebar-trim hide chrome that's irrelevant to the role. They don't lock features — a tech promoted to supervisor sees the bigger sidebar without redeploying.
5. **Personas annotate findings; stages drive priorities.** The UX audit's brand-new-tech / experienced-tech / apprentice personas tell us "who hits this friction." The stage tells us "is this friction acceptable at this stage of their use?"

## Map of what's already in flight

For each stage, what's landed / building / queued in the current PR slate:

| Stage | Landed | Building (open PRs) | Queued |
|---|---|---|---|
| 1 | TechDashboard (#156), /do action hub (#157), SetupChecklist real-data gate (#159) | — | PR I — Tech welcome card |
| 2 | Mine/All filter (#156), 44px tap targets (#158), kind-aware tagline + demoted Customer Report (#160) | PR D — Smart defaults framework | PR E — Detail-page Add CTAs, PR G remainder (auto-start on first tap, print promotion) |
| 3 | Excel import flows (Delta WO, Jemena RCD), tier framework Phase A | — | Saved views, scheduling-dispatch board, PWA + offline (competitive audit) |
| 4 | `/admin/*`, MCP integrations | — | Bulk invite CSV, tenant config export/import, EQ Shell canonical tie-in |

## Open questions for Royce

These shape the next PRs and should be answered before stage-1 polish hardens:

1. **Per-user persistent preferences** — store them in `tenant_members` (rejoin per-tenant) or in a new `user_preferences` table? Today there's no canonical store. Stage 3 needs this.
2. **Skill-mode override** — should users be able to opt-in to "Basic / Standard / Advanced" mode (per the 2026 EQ Field deferral)? Or does the stage-progression happen entirely organically through the surfaces? Recommendation: organic for now. If a user complains the app is too sparse for them, that's the signal to add the toggle.
3. **Onboarding coach-marks** — first-tour tooltips on the first session? Or just trust empty states + the SetupChecklist? Recommendation: trust empty states for now; tour adds complexity that doesn't survive contact with real users.
4. **Where stage-4 lives** — most of stage 4 is admin-block work that's already half-built. Should `/admin` get its own hub-page treatment (like `/records` and `/insights`)? Currently it's just a top-level link.

## Cross-references

- **EQ Field mobile-first nav** ([`_proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md`](../../C:/Projects/eq-solves-field/_proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md)) — staff vs supervisor split (role, not stage). Compatible: their role-axis × this stage-axis = the grid we design against.
- **UX audit** ([`docs/audits/2026-05-18-creation-flows-ux.md`](../audits/2026-05-18-creation-flows-ux.md)) — friction findings, persona-annotated.
- **Competitive feature audit** ([`docs/audits/2026-05-19-competitive-features.md`](../audits/2026-05-19-competitive-features.md)) — what competitors do at stages 2 + 3 that we don't.
- **EQ Tenancy Model** ([`C:/Projects/eq-intake/EQ-TENANCY-MODEL.md`](../../C:/Projects/eq-intake/EQ-TENANCY-MODEL.md)) — per-tenant Supabase + EQ Shell + lazy-loaded modules. Stage-4 questions land here.

## Status

Draft. Living doc. Update with `last_updated:` line when stage definitions change. Future PRs should reference the stage they primarily serve in their PR body — makes prioritisation visible.
