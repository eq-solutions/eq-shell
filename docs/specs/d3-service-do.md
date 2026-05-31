# Spec: EQ Service — "Do" screen
**Status:** APPROVED — decisions locked 2026-06-01. Ready for D3.3 build.
**Design ref:** `EQ Service - Do.html` (Direction D handoff bundle)
**Task:** D3.1 → feeds into D3.3 build wave

## Confirmed decisions (2026-06-01)
| # | Question | Decision |
|---|---|---|
| Q1 | Data source | `work_orders` table |
| Q2 | Assignment model | User-level — `assigned_to = auth.uid()` |
| Q3 | Shell deep-link default | Dashboard (manager default); technician navigates to Do via Service sidebar |
| Q4 | Status enum | `open → in_progress → completed` (confirmed correct) |
| Q5 | Escalate action | Creates a defect record linked to the WO via existing defects API |

---

## What it is

The action-first entry point in EQ Service. A technician opens Service, sees their assigned work orders for today, and acts on them immediately — no navigation required. This is not the full work-order list (that lives at `/maintenance`). "Do" is the opinionated view: your queue, right now.

The design handoff describes it as "ranked next jobs, one big Start CTA each". That framing is right. The screen should feel like a task list, not a data grid.

---

## Route

Within EQ Service (Next.js app), the route is `/do`. The EQ Service sidebar already lists "Do" as the first item (per design handoff IA). The Shell's `ServiceIframe` embeds the whole Service app, so Shell just needs to pass the right initial path if it wants to deep-link directly to Do — no new Shell route required.

Deep-link from Shell (if needed): `{SERVICE_URL}/do` — Shell can append this to the iframe `src` once the auth handshake is complete.

---

## Layout

Mobile-first. Technicians use this on phones at site. The layout works in a single column at all widths; at desktop it widens to ~640px centred.

### Top summary bar

Sits above the card list. Fixed/sticky at the top on mobile so it's always visible while scrolling.

Contents (left to right):
- Today's date in plain format: `Tuesday 3 June`
- "X open" — count of work orders with status `open` or `in-progress` assigned to the current user
- "X priority" — count of WOs with `priority: high` or `overdue` status

Use the `Card` component (tint white, padding sm) for this bar. Counts as plain numbers with small grey labels beneath. Do not use KPI-style large numbers here — this is a glance, not a dashboard.

States:
- Loading: two `Skeleton` text blocks
- 0 open: show "Nothing assigned today" with a secondary message "Check back later or ask your supervisor."

### Tab strip

Three tabs using the `Tabs` component:

| Tab | What it shows |
|---|---|
| All | Every WO assigned to the current user, any status except Completed |
| Priority | High priority + overdue only |
| Completed | WOs marked complete today |

Default active tab: All.

Tab counts appear as small badges inside each tab label (e.g. "All 4", "Priority 2").

### Work order card list

One `Card` per work order, stacked vertically, 12px gap between cards. Full-width on mobile.

Each card contains:

| Element | Detail |
|---|---|
| WO ref | e.g. `WO-2410` — small, grey, top-left |
| Site name | Bold, 15px, one line truncated |
| Kind | `KindPill` — `preventive`, `corrective`, or `inspection` |
| Status | `StatusBadge` — `open`, `in-progress`, `overdue`, `await` |
| Due time | Plain text: `Due 2:00 PM` or `Due today` or `Overdue — was 9:00 AM` |
| Quick-action button | See interactions below |

Card border: 1px `g200` (#E4DDD2). No shadow. Radius 8px. Padding 16px.

When status is `overdue`, the card left border is 3px solid `#B91C1C` (error fg) to draw immediate attention. No background tint — colour is not the only indicator; the StatusBadge label also reads "Overdue".

### Empty state

When a user has no WOs assigned:
- Lucide `CheckCircle2` icon, 32px, `g400` colour
- Heading: "You're all clear"
- Body: "No work orders are assigned to you today."

---

## Key components (from `@eq-solutions/ui`)

- `Card` — WO cards and summary bar
- `StatusBadge` — WO status
- `KindPill` — WO kind (preventive / corrective / inspection)
- `Tabs` — All / Priority / Completed
- `Button` — quick-action (variant: primary, size: sm on mobile)
- `Skeleton` — loading state for summary bar and card list
- `Modal` / `ConfirmDialog` — escalate confirmation

---

## Key interactions

### Start / Mark complete

Each card has one primary action button, right-aligned:

- If status is `open`: button label is "Start" — clicking transitions status to `in-progress`. Button variant: `primary`.
- If status is `in-progress`: button label is "Mark complete" — clicking opens a `ConfirmDialog`: "Mark this job as complete? You can't undo this without a supervisor." Confirm → status becomes `completed`, card moves to Completed tab.
- If status is `overdue`: button label is "Start" (same as open). Visual urgency comes from the left border, not the button colour.

All status transitions hit the existing Service API: `PATCH /api/maintenance/{id}` with `{ status: 'in_progress' }` or `{ status: 'completed' }`.

### Escalate

Each card has a secondary ghost `Button` with a Lucide `AlertTriangle` icon — label "Escalate". Clicking opens a small modal with a text area ("Describe the issue") and a submit button. On submit, creates a defect linked to the WO via the existing defects API.

### View detail

Tapping/clicking the card body (not the buttons) navigates to the existing WO detail page: `/maintenance/{id}`. This is a standard Next.js router push — no deep-link to Shell required.

### Pull to refresh (mobile consideration)

Mark the card list container with a CSS scroll region. Consider a simple "Refresh" button at the top of the list rather than native pull-to-refresh, since this is a web view not a native app.

---

## Auth context

EQ Service is embedded in Shell as an iframe (Service Iframe page at `src/pages/ServiceIframe.tsx`). Auth is established by Shell via either cookie mode or the HMAC token handshake. Once the iframe is ready, the user is fully authenticated inside Service — no additional auth step for the Do screen.

The Do screen reads `assigned_to` on work orders, matched against the current Supabase user's ID. This requires `auth.uid()` to be available in Service's Supabase client — it will be, since session is established before the page renders.

---

## Data source

Table: `work_orders` (or `pm_calendar` — confirm which table holds assigned daily WOs in the Service DB).

Query: `WHERE assigned_to = auth.uid() AND status IN ('open', 'in_progress', 'overdue') AND due_date = today`.

The "Completed today" tab adds: `AND status = 'completed' AND completed_at::date = today`.

---

## Open questions for Royce

1. **Data model**: Is "Do" pulling from `work_orders`, `pm_calendar`, or both? The calendar page at `/calendar` queries `pm_calendar` with an `assigned_to` field on technicians. Clarify whether `pm_calendar` entries are the "work orders" for Do, or if there's a separate `work_orders` table being built.

2. **Assignment source**: Are WOs assigned to individual technicians (user ID), to a team, or to a site? The spec assumes user-level assignment. If team-level, the query and "my queue" framing need adjustment.

3. **Deep-link from Shell**: Should the Shell's "Open EQ Service" tile navigate directly to `/do` (the action screen) or to the Service dashboard? If Do is the default landing, the ServiceIframe should set `src` to `{SERVICE_URL}/do` rather than `{SERVICE_URL}/shell`.

4. **Status transitions via Do screen**: Does marking complete from Do update the same record that managers see in the full maintenance view? Confirm the status enum matches: `open → in_progress → completed`.

5. **Escalate action**: Does escalating from Do create a defect record or a separate escalation record? The spec assumes defect creation — confirm this matches the existing defects data model.
