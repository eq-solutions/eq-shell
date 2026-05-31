# Spec: Calendar screen
**Status:** APPROVED — decisions locked 2026-06-01. Ready for D3.3 build.
**Design ref:** `EQ Service - Calendar.html` (Direction D handoff bundle)
**Task:** D3.1 → feeds into D3.3 build wave

## Confirmed decisions (2026-06-01)
| # | Question | Decision |
|---|---|---|
| Q1 | Week view priority | Defer — month + list only for D3.3 |
| Q2 | Notification deep-link | Yes — support `?id=xxx` deep-link from notifications; ServiceIframe accepts path suffix |
| Q3 | Unified future | Yes — unified Shell-level calendar (Field + Service) is the goal; plan for D4+ |

---

## Remit warning — read first

Global CLAUDE.md rule: "Resources, hours, availability, licences, dispatch, shutdowns → EQ Field only."

This rule is directly relevant. A calendar that shows staff availability, roster slots, dispatch, or scheduled shifts belongs to Field — Shell or Service should not write that data.

**Recommendation: display-only, scoped to EQ Service's PM calendar data.**

The calendar that already exists in EQ Service (`/calendar`, built on `pm_calendar`) is the right foundation. It shows preventive maintenance events, their due dates, statuses, and site assignments. That is Service data — not Field data. Building this calendar inside Service (or surfacing it through the Service iframe in Shell) does not conflict with Field's remit, as long as the calendar does not write availability, roster, or dispatch records.

If a future requirement emerges to show Field's staff schedule alongside Service's PM calendar on one surface, that should be a separate decision handled in Field first, then a read-only data feed from Field to the Shell-level calendar. Do not design for that case now.

**Scope for D3.3:** Reskin and elevate the existing `/calendar` page in EQ Service to Direction D. Do not build a new Shell-level calendar route. Do not pull Field data.

---

## What it is

A visual PM (preventive maintenance) planning calendar inside EQ Service. Shows scheduled maintenance events by month or week, colour-coded by status, with site and category filters. Managers use it to plan workloads; technicians use it to see what's coming up.

The route `/calendar` already exists in Service (previously `/pm-calendar`, now redirected). The existing implementation has three view modes: calendar (month grid), list, and quarterly. Direction D targets the month-grid view as the default (that decision is already in the code: `viewMode = 'calendar'`).

---

## Route

`/calendar` within EQ Service. No new Shell route needed — this is accessed via the Service iframe.

If Shell needs to deep-link to a specific month: `{SERVICE_URL}/calendar?view=calendar&fy=FY2526`.

---

## Layout

### Filter rail (left, collapsible on mobile)

Width: 220px on desktop. On mobile, collapses to a filter icon button that opens a drawer.

Filters available (all already supported by the existing query params):
- Search (text input)
- Site (dropdown, pulls from `sites`)
- Category (dropdown, unique values from `pm_calendar.category`)
- Financial year (dropdown)
- Status (dropdown: open, in-progress, overdue, completed)

Below filters, a small legend:
- Dot + "Open" (sky)
- Dot + "In progress" (blue)
- Dot + "Overdue" (red)
- Dot + "Completed" (green)

### Toolbar (above calendar grid)

Left: current month + year, with prev/next arrow buttons (Lucide `ChevronLeft`, `ChevronRight`).

Right: view toggle using `Tabs` component: Week | Month | List. Default: Month.

Right of toggle: "Add" button (Lucide `Plus`, variant `primary`, size sm) — visible to admin and supervisor roles only (`canWrite`).

### Calendar grid (month view)

7-column grid. Days with events show event chips inside the day cell.

Event chip: `KindPill`-style compact chip — one line of text (event title truncated), left border coloured by status:
- open: sky (`#3DA8D8`)
- in-progress: deep blue (`#2986B4`)
- overdue: error red (`#B91C1C`)
- completed: success green (`#15803D`)

Clicking a chip opens the event detail drawer (existing `PmCalendarDetail` component) — no navigation away from the calendar.

Days past today that have overdue events: subtle amber background on the day cell (`#FFFBEB`). Not the whole row — just the cell.

### Week view

7-column, single-week grid. Same chip style. Shows time-of-day on left axis if events have `start_time`. If no start_time, chips stack top-to-bottom in the day column.

### List view

The existing list/table view — reskinned to Direction D (cornerstone table: sky header, zebra rows). Pagination as existing. No behaviour change.

---

## Key components (from `@eq-solutions/ui`)

- `Tabs` — Week / Month / List toggle
- `Card` — event chips and day cells in the grid
- `KindPill` — event kind within detail drawer
- `StatusBadge` — status within detail drawer and list view
- `Button` — Add, prev/next, filter toggle
- `Modal` / `ConfirmDialog` — Add/Edit event form, delete confirmation
- `FormInput` — Add/Edit event form fields
- `Skeleton` — loading state while fetching calendar data
- `Table` — list view (cornerstone pattern)

---

## Key interactions

### Navigate months/weeks

Prev/next buttons update the visible date range. Filter params and site/category filters persist across navigation — no full page reload (client-side state).

### Click event chip

Opens `PmCalendarDetail` drawer (right side on desktop, bottom sheet on mobile). Shows full event details: title, site, category, assigned technician, due date, status, notes. Edit button (admin/supervisor only) opens the edit form.

### Add event

"Add" button opens the existing `PmCalendarForm` in a `Modal`. No spec change to the form — just the Direction D visual skin.

### Status update

Inside the detail drawer, a status selector (dropdown or segmented control) allows direct status update without opening the full edit form. Admin and supervisor roles only. Fires `PATCH /api/pm-calendar/{id}` (or equivalent existing API).

### Empty state

If no events match the current filters for the visible month:
- Lucide `CalendarX2` icon, 32px, `g400`
- "No events scheduled for [Month Year]"
- If filters are active: "Try clearing your filters."

---

## Integration

Data source: `pm_calendar` table in EQ Service's Supabase DB. No Field data is pulled. No new tables are required — this is a reskin + interaction polish of the existing calendar page.

The existing `/calendar` page in Service already handles all filtering, pagination, and data fetching correctly. The D3.3 build task is:
1. Apply Direction D tokens (warm sand neutrals, sky status colours).
2. Build the month-grid calendar layout (the visual grid itself — `PmCalendarView` today has this but needs Direction D styling).
3. Add the week view (new, lower priority — ship month view first).
4. Replace spinner-on-blank loading states with `Skeleton` chips in the grid cells.

---

## What is explicitly out of scope

- Staff roster / availability — belongs to Field.
- Shift scheduling, dispatch, or leave — belongs to Field.
- A Shell-level `/calendar` route that aggregates across apps — deferred to D4+.
- Writing any data to Field from this screen.

---

## Open questions for Royce

1. **Week view priority**: Is week view needed for D3.3 or can it ship after month + list? The month-grid is the default and what the design handoff shows. Week view could be a later sprint.

2. **Shell deep-link**: If a user clicks a notification that references a specific calendar event (e.g. a supervisor digest email), should Shell land them on `/calendar` in Service with a pre-filtered view? If yes, the `ServiceIframe` needs to pass a path suffix — confirm this is the right approach or if a postMessage deep-link pattern is preferred.

3. **Field calendar — future**: When Field eventually exposes a roster/availability read API, does the vision call for a unified Shell-level calendar or keeping them separate? This doesn't affect D3.3 but shapes D4+ planning.
