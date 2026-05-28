# EQ Shell — Sprint Plan

**Last updated:** 2026-05-28  
**Repo:** eq-shell  
**Cadence:** 2-week sprints  
**Active branches:** `main` (prod), `claude/*` (feature)

---

## Legend

- Effort: S = half day, M = 1–2 days, L = 3–4 days, XL = 5+ days
- Deps: ticket IDs this ticket blocks on
- Perm = requires explicit auth approval before deploy

---

## S1 — Entity Browser & Data Layer (2026-06-02 → 2026-06-13)

Core goal: make the entity browser writable and filterable, completing the data layer that Cards and Intake depend on.

### S1-01 — Active/inactive filter toggle on entity browser
- **Description:** Add a toggle (Active / Inactive / All) above the entity table. Pass the filter to the `entity-rows` Netlify function and thread it through to the `eq_browse_entity` RPC call. The RPC already has a `p_active` param seeded in migration `0014`; the UI just needs to wire it. Toggle state should survive column-sort and search changes.
- **Effort:** S
- **Deps:** none

### S1-02 — Entity detail page (read-only)
- **Description:** Clicking a row in the entity browser navigates to `/:tenant/data/:entity/:id`. Fetch the full row via a new `entity-detail` Netlify function (reads from `eq_get_entity` RPC or a direct select). Display all columns in a labelled card layout. No editing yet. Includes a breadcrumb back to the list.
- **Effort:** M
- **Deps:** none

### S1-03 — Entity edit form (manager/supervisor only)
- **Description:** Add an "Edit" button on the detail page (gated by a new `entity.edit` permission in the matrix). Renders an auto-generated form from the column schema returned by the detail function. On submit, calls a new `entity-patch` Netlify function that validates the payload server-side and writes to the tenant data plane. Show inline field-level validation errors.
- **Effort:** L
- **Deps:** S1-02
- **Perm note:** server-side write path needs explicit sign-off before deploy

### S1-04 — Entity create form (manager only)
- **Description:** Add a "New" button on the browser list page gated by `entity.create`. Reuses the form component from S1-03 with all fields empty. Calls a new `entity-insert` Netlify function. On success, redirect to the new row's detail page.
- **Effort:** M
- **Deps:** S1-03

### S1-05 — Import validation UI improvements
- **Description:** The CSV import flow in `EntityImportPanel` currently shows a raw error count. Replace with: (a) a per-row error accordion showing which column failed and why, (b) a "download flagged rows as CSV" button for the operator to correct and re-import, (c) a summary banner (X committed, Y flagged, Z rejected) using the existing `rows_committed / rows_flagged / rows_rejected` fields already in the API response. No backend changes needed.
- **Effort:** M
- **Deps:** none

### S1-06 — Permission matrix: entity CRUD keys
- **Description:** Add `entity.view`, `entity.create`, `entity.edit`, `entity.delete` to `src/permissions/matrix.ts`. Grant: `view` → all roles; `edit` → manager + supervisor; `create` + `delete` → manager only. Update `Gate` usage in S1-03/S1-04. Add a `entity.ts` module permissions file following the pattern in `intake/permissions.ts`.
- **Effort:** S
- **Deps:** none (ship before S1-03 starts)

---

## S2 — EQ Cards Implementation (2026-06-16 → 2026-06-27)

Core goal: replace the `ComingSoon` stub in `src/modules/cards.tsx` with a real onboarding flow.

### S2-01 — Cards module scaffold
- **Description:** Replace the `ComingSoon` stub with a proper Cards module entry point. Add routes `/:tenant/cards` and `/:tenant/cards/:id`. Sidebar entry already exists. Module should render a staff cards list (fetched from tenant data plane `staff` table). Apply `moduleEnabled('cards')` guard from session — already threaded into `HubSidebar` and `HUB_APPS`.
- **Effort:** M
- **Deps:** none

### S2-02 — Cards: staff onboarding intake flow
- **Description:** Multi-step form for adding a new staff member: (1) personal details, (2) licences + certifications, (3) availability/start date, (4) review + submit. On submit, write to the tenant `staff` table via a new `cards-onboard` Netlify function. Emit a `staff.onboarded` canonical event to `shell_control.canonical_events`. Show a printable card summary after completion.
- **Effort:** XL
- **Deps:** S2-01

### S2-03 — Cards: JWT tenant_id backfill for direct sign-ins
- **Description:** Mobile users who sign in directly via Cards bypass Shell login and therefore miss `app_metadata.tenant_id` in the Supabase JWT (documented in memory: `cards-jwt-tenant-id.md`). Add a Supabase auth hook (or a post-login Netlify redirect) that reads the user's tenant from the `tenant_users` table and patches `app_metadata` before the JWT is issued. Test with a direct login and verify the JWT claim is present.
- **Effort:** L
- **Deps:** none
- **Perm note:** auth hook change — explicit approval required before deploy

### S2-04 — Admin: Cards feed review page improvements
- **Description:** `AdminCardsFeed.tsx` exists but is minimal. Add: (a) status filter (pending / approved / rejected), (b) bulk-approve action (manager only, `admin.review_cards` perm already in matrix), (c) link from each row to the staff detail page (S1-02). No new backend function needed — extend the existing `admin-cards-feed` query.
- **Effort:** M
- **Deps:** S1-02, S2-02

---

## S3 — Notifications & Alerts Centre (2026-06-30 → 2026-07-11)

Core goal: surface cross-app events to users without requiring them to poll individual apps.

### S3-01 — Notifications schema
- **Description:** Add a `notifications` table to `shell_control` schema on eq-canonical. Columns: `id`, `tenant_id`, `user_id` (nullable — null = tenant-wide), `app_source`, `event_type`, `title`, `body`, `action_url`, `read_at`, `created_at`. Add a migration file in `supabase/shell-migrations/`. Add a RLS policy: users see their own + tenant-wide rows, managers see all tenant rows.
- **Effort:** M
- **Deps:** none

### S3-02 — Notification writer function
- **Description:** New Netlify function `notify-create` that accepts a canonical event payload and writes a formatted notification row. Called internally by other functions (e.g., `cards-onboard` from S2-02 emits a `staff.onboarded` event → `notify-create` writes the notification). Not a public-facing endpoint.
- **Effort:** S
- **Deps:** S3-01

### S3-03 — Bell icon + notification drawer
- **Description:** Add a bell icon to `Topbar.tsx` with an unread count badge. Clicking opens a drawer (slide-in panel) showing the 20 most recent notifications for the user. Each row: title, body, timestamp, "Mark as read" action. "Mark all read" button at the top. Fetch from a new `notifications-list` Netlify function. Poll every 60 seconds (no websocket needed at this scale).
- **Effort:** L
- **Deps:** S3-01, S3-02

### S3-04 — Notification triggers: canonical events → notifications
- **Description:** Wire the existing canonical event types in `EVENT_META` (quote.created, quote.accepted, defect.created, maintenance_check.completed) to the notification writer. Each canonical event ingest function should call `notify-create` after writing the event. Document which events produce tenant-wide vs. user-specific notifications.
- **Effort:** M
- **Deps:** S3-02

---

## S4 — Mobile Responsive + UX Polish (2026-07-14 → 2026-07-25)

Core goal: shell is usable on an iPad/phone for field staff checking rosters and their cards.

### S4-01 — HubSidebar mobile collapse
- **Description:** On viewports < 768px, the sidebar should be hidden by default and toggled via a hamburger in `Topbar.tsx`. Currently it overlaps content on mobile. Implement as a CSS-driven slide drawer using a `data-open` attribute — no JS animation library. Ensure focus is trapped when open and the overlay dismisses it.
- **Effort:** M
- **Deps:** none

### S4-02 — Entity browser: mobile-friendly table
- **Description:** The entity table with 5 columns overflows on narrow screens. On mobile, collapse to a single "card" row per entity showing the first two columns and an expand chevron. Implement via CSS container queries (`@container`) so it degrades gracefully in older browsers. The sort/filter bar should stack vertically.
- **Effort:** M
- **Deps:** none

### S4-03 — Login page mobile layout
- **Description:** `LoginPage.tsx` has a fixed-width card that clips on small screens. Make the card full-width on mobile with appropriate padding. PIN entry should use `inputmode="numeric"` to trigger the numeric keyboard on iOS/Android. Test with Chrome DevTools mobile emulation for iPhone SE (375px) and iPad (768px).
- **Effort:** S
- **Deps:** none

### S4-04 — Dashboard responsive grid
- **Description:** KPI tiles on `TenantHome.tsx` are in a rigid grid. On mobile, stack into a single column. The live feed and recent activity panels should each take full width below the KPIs. Use existing CSS grid — add responsive breakpoints only, no layout restructure.
- **Effort:** S
- **Deps:** none

### S4-05 — Topbar responsive cleanup
- **Description:** On mobile, the topbar shows the tenant name + user name + nav items which overflow. Trim to: logo + hamburger (left), user avatar + notifications bell (right). Tenant name moves into the sidebar drawer header.
- **Effort:** S
- **Deps:** S4-01

---

## S5–S10 — Medium-term Epics

These are planned at epic level. Tickets are defined at the start of the sprint.

---

### S5 — Tenant Onboarding (Self-Serve Signup)
**Goal:** A new customer can sign up at `eq.solutions`, provision a tenant slug, and reach a working Shell login without manual intervention from EQ Solutions.

Key work areas:
- Public signup page + Netlify function to create tenant row in `shell_control.tenants`
- Supabase project provisioning (or pre-provisioned pool allocation) for the new tenant
- Email verification flow using Supabase Auth
- Default module entitlements for trial tier
- Onboarding wizard: name, logo, first admin user, first staff import (Cards flow from S2)
- Tenant subdomain routing: `{slug}.eq.solutions` via Cloudflare Worker (documented in memory: `netlify-wildcard-limitation.md`)

**Dependencies:** S1, S2 complete; Cloudflare Worker proxy in place  
**Effort:** XL (full sprint + likely overflow)

---

### S6 — Role-Based Access Control Hardening
**Goal:** Every server-side function enforces role checks; every UI surface respects them; audit trail is complete.

Key work areas:
- Audit all Netlify functions for missing role validation — add `assertRole()` calls consistently
- Add `platform_admin` bypass at function level (mirrors the existing client-side `is_platform_admin` short-circuit)
- Extend permission matrix for Cards, Quotes, Service module actions
- `Gate` component: add a `fallback` prop for graceful degradation instead of null renders
- Role escalation flow: manager can promote employees to supervisor (currently no UI)
- Review and document the supervisor vs employee distinction — currently supervisor has `audit.view` only, likely needs expand

**Dependencies:** S1-06 complete  
**Effort:** L

---

### S7 — Dashboard Customisation
**Goal:** Managers can pin KPIs and rearrange dashboard widgets.

Key work areas:
- `dashboard_config` table in `shell_control` schema per tenant/user
- Draggable widget grid (react-grid-layout or CSS-only drag API)
- Widget catalogue: KPI tiles, live feed, recent activity, quick-link shortcuts
- Save/load layout from Netlify function
- Default layout per tier (trial gets a fixed minimal layout)
- Reset to default button in Admin settings

**Dependencies:** S5 (self-serve) not required; can run in parallel  
**Effort:** XL

---

### S8 — API Rate Limiting & Abuse Protection
**Goal:** Public-facing Netlify functions can't be abused by unauthenticated crawlers or brute-forced on the login endpoint.

Key work areas:
- Login endpoint: IP-based rate limit (5 attempts / 15 min) using Netlify Edge middleware or a KV store (Upstash Redis)
- `verify-shell-session`: return 401 fast if cookie is absent without a DB round-trip
- All other functions: short-circuit on missing/invalid cookie before DB call
- Add `Retry-After` headers on 429 responses
- Sentry alert on sustained 429 spike (abuse signal)
- Document rate limits in internal runbook

**Dependencies:** none  
**Effort:** L

---

### S9 — EQ Expenses Module (Stub + Schema)
**Goal:** Lay the data foundation for expense capture so Field staff can log expenses against jobs.

Key work areas:
- `expenses` table in tenant data plane (amount, category, job_ref, submitted_by, approved_by, status, receipt_url)
- Module entitlement added to admin settings (`MODULE_LABELS` in `AdminTenantSettings.tsx`)
- `ComingSoon` stub wired into sidebar (same pattern as Cards was before S2)
- Netlify function `expense-submit` and `expense-approve` (schema only, no UI yet)
- Emit `expense.submitted` and `expense.approved` canonical events
- Sentry project `eq-expenses` created and DSN plumbed in

**Dependencies:** S3 (notifications) recommended so expense approvals can trigger alerts  
**Effort:** M (schema + stub), XL (full UI in a later sprint)

---

### S10 — EQ Ops Dashboard (Stub + Event Aggregation)
**Goal:** Provide a tenant-level operations view aggregating activity across all modules.

Key work areas:
- Aggregation function that rolls up canonical events into daily/weekly/monthly buckets
- `ops_summary` materialised view or scheduled function (Netlify scheduled function or Supabase cron)
- Ops dashboard page: time-series sparklines for quotes, defects, staff events, expenses
- Filter by date range + app source
- Export as CSV (same button pattern as import download in S1-05)
- Module entitlement gated to `advanced` + `enterprise` tiers only

**Dependencies:** S3 (canonical events), S9 (expenses schema) for full coverage  
**Effort:** XL

---

## Deferred / Parking Lot

Items that are known but not yet sprint-scheduled:

- **TOTP enforcement by tier** — `EnrollTotp.tsx` and `TotpChallenge.tsx` exist; make TOTP mandatory for `manager` role on `advanced`+ tenants
- **StorageBrowser hardening** — `StorageBrowser.tsx` exists but has no delete/rename; currently unlinked from main nav
- **Audit log rollback** — `audit.rollback` perm exists in matrix, `AdminAuditPage.tsx` exists, but the rollback Netlify function is not implemented
- **TenantSwitcher** — `TenantSwitcher.tsx` exists; platform_admin users need a proper cross-tenant context switch without full re-login
- **Offline/PWA** — service worker caching for entity browser so field staff can view records in low-signal areas
- **EQ Field deep-link routing** — `field_tenant_slug` is set per tenant; the Field iframe should open to the correct sub-route rather than always landing on the Field home

---

## Non-Negotiables (carry into every ticket)

- No hardcoded credentials anywhere — all secrets via Netlify env vars
- Auth-touching PRs need explicit approval before merge to main
- Working before refactoring — new features on green paths before touching existing flows
- EQ and SKS data never co-mingled — tenant isolation checked at function level, not just UI
- Every new Netlify function gets a Sentry `captureException` in its catch block
