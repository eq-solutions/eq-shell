# Notifications, Digests & Reminders — Design Doc

**Status:** draft v0.1, 2026-04-29
**Owner:** Royce
**Decision needed by:** before any of the missing triggers gets built

---

## Goals

1. **Don't miss deadlines.** Field techs and supervisors know what's coming, what's overdue, and what just landed in their queue — without checking the app.
2. **Customers see proof of work.** Commercial-tier customers receive timely updates about their sites without the account manager having to hand-craft an email.
3. **Audit trail.** Every notification is recorded so we can answer "did the customer get the report?" and "when was the tech told?".
4. **Per-tenant tier control.** Free-tier (e.g. SKS NSW) gets the technician-facing notifications; commercial-tier (e.g. Linesight-shaped customers) adds customer-facing emails. Same flag as the rest of the bridge plan: `tenant_settings.commercial_features_enabled`.

---

## What's already built

| Piece | Location | Status |
|------|---------|--------|
| `notifications` table + RLS | `supabase/migrations/0011_notifications.sql` | ✅ live |
| Bell UI | `components/ui/NotificationBell.tsx` | ✅ live |
| `createNotification` helper | `lib/actions/notifications.ts` | ✅ live |
| `markAsRead`, `markAllRead`, `getUnreadCount` | same | ✅ live |
| `check_assigned` trigger (when tech assigned) | `app/(app)/maintenance/actions.ts:610,719` | ✅ live |
| `check_completed` trigger (when status flips) | `app/(app)/maintenance/actions.ts:818` | ✅ live |
| Resend email infra | `lib/email/send-report-email.ts` | ✅ live |
| Supervisor digest email helper | `lib/email/send-supervisor-digest.ts` | ✅ helper exists |
| Supervisor digest audit table | `supervisor_digests` | ✅ live |
| `pm_calendar_for_supervisor` RPC | migration ~0040s | ✅ live (powers digest) |

## What's missing

| Piece | Why it matters |
|------|---------|
| `check_overdue` auto-trigger | Type defined in migration 0011 but no code path creates the notification when `due_date` passes |
| `defect_raised` auto-trigger | Type defined; no code path creates the notification when a defect is logged |
| **Pre-due reminders** (14d / 7d / 1d before `due_date`) | Highest-value notification we don't have. Currently techs only learn about a check when they open the calendar |
| **Cron / scheduling layer** | Nothing fires automatically. Supervisor digest helper exists but isn't called by anything on a schedule |
| **Customer-facing emails** (other than report deliveries) | Customers get reports but no monthly summary, no upcoming-visit notice, no defect notice |
| **Customer-facing in-app surface** | Portal shows reports only; doesn't show notifications/upcoming work/defects |
| **Notification preferences** | Users can't opt in/out per-channel or per-type. All-or-nothing right now |
| **Escalation paths** | Critical defect → admin notified; no such logic today |
| **Slack/Teams integration** (future) | Out of scope for v1 but worth noting in the trigger matrix so we don't paint into a corner |

---

## The trigger matrix

This is the canonical "what fires when" table. Open question marks are the decisions that need your call before we build.

### Internal-facing (free + commercial tiers, always on)

| # | Trigger event | Audience | Channel | Cadence | Built? |
|---|---|---|---|---|---|
| 1 | Check assigned to a technician | Tech | Bell + Email | Real-time | Bell ✅, Email ❌ |
| 2 | Check 14 days from `due_date` | Tech + Supervisor | Email | Cron 7am AEST | ❌ |
| 3 | Check 7 days from `due_date` | Tech | Bell + Email | Cron 7am AEST | ❌ |
| 4 | Check 1 day from `due_date` | Tech + Supervisor | Bell + Email | Cron 7am AEST | ❌ |
| 5 | Check `due_date` passed (overdue) | Tech + Supervisor | Bell + Daily digest | Real-time + 7am | ❌ |
| 6 | Check completed | Supervisor | Bell | Real-time | ✅ |
| 7 | Defect raised (any severity) | Tech (creator) + Supervisor | Bell | Real-time | ❌ |
| 8 | Defect raised (critical) | + Admin / super_admin | Bell + Email immediate | Real-time | ❌ |
| 9 | Test failed (ACB / NSX / RCD) | Tech + Supervisor | Bell | Real-time | ❌ |
| 10 | Variation created | Supervisor + Admin | Bell | Real-time | ❌ |
| 11 | Variation status flips to approved | Admin | Bell + Email | Real-time | ❌ |
| 12 | Coverage gap detected | Admin | Bell + Daily digest | Real-time + 7am | ❌ |
| 13 | Period locked | Admin (audit notice) | Bell | Real-time | ❌ |
| 14 | **Daily supervisor digest** (4-bucket roll-up) | Supervisor | Email | Mon-Fri 7am AEST | Helper ✅, schedule ❌ |
| 15 | **Weekly admin digest** (KPIs, gaps, overdue) | Admin | Email | Mon 7am AEST | ❌ |

### Customer-facing (commercial tier only, gated)

| # | Trigger event | Audience | Channel | Cadence | Built? |
|---|---|---|---|---|---|
| C1 | Report delivered (existing flow) | Customer contact | Email + Portal | Real-time | ✅ |
| C2 | Upcoming visit — 7 days out | Customer site contact | Email | Cron 7am AEST | ❌ |
| C3 | Critical defect on customer asset | Customer account contact | Email | Real-time | ❌ |
| C4 | Variation status flips to approved | Customer account contact | Email | Real-time | ❌ |
| C5 | **Monthly summary** — visits done, scope coverage %, open defects | Customer account contact | Email | 1st of month, 7am AEST | ❌ |
| C6 | Renewal pack ready | Customer account contact | Email | On-demand (admin triggers) | ❌ |

---

## Decisions Royce needs to make

### D1. Cron infrastructure
We need *something* that fires schedules. Three viable options:

1. **(recommended) Supabase `pg_cron` + `pg_net`** — schedule SQL or HTTP-call jobs in the database. Stays inside our existing stack, no extra service. Native to Supabase. Postgres 14+ supports it natively.
2. **Netlify Scheduled Functions** — `netlify.toml` cron syntax, calls a `/api/cron/*` route handler. Lives in our existing deploy pipeline, but ties cadence to deploys.
3. **External (GitHub Actions)** — schedule cron jobs in `.github/workflows/`, hit a public endpoint with a shared secret. Reliable but adds another moving part.

### D2. Email cadence default
For each of the cron-driven items, what's the default time? Proposing **7am AEST Mon-Fri** so the tech sees the email with their morning coffee. Weekend silence is intentional — no notifications fire Sat/Sun unless something changes (real-time triggers still fire).

### D3. Escalation rules
- Critical defect: admin notified immediately (proposed). Yes/no?
- Overdue check >14 days: super_admin notified daily until resolved (proposed). Yes/no?
- Coverage gap >$10k expected_amount: admin notified within 1 hour (proposed). Threshold value?

### D4. Customer-facing scope (commercial tier)
- Are we comfortable emailing the customer's site contact directly when a critical defect is on their asset? Or should it route through the SKS account manager first?
- Monthly summary email — does the customer opt in, or is it on by default for commercial-tier customers?
- Per-customer notification preferences UI — needed v1, or "email everything to the account manager" v1 with prefs as v2?

### D5. Notification preferences storage
Two-axis preference matrix per user (push / email / digest × per-event-type). Probably a `notification_preferences` table. Default settings per role:
- Tech: bell + email for assigned/overdue, bell only for else
- Supervisor: digest 7am, real-time bell for everything else
- Admin: real-time bell + email for critical, digest for else
- Customer (commercial): email for visits + reports + monthly summary, all else off

Confirm defaults, or rewrite?

### D6. Channel beyond email
- SMS for urgent (critical defects, day-of overdue)? Twilio integration is ~half a day.
- Slack/Teams webhook per tenant? Cheap but per-tenant config.
- Keep to email-only v1?

---

## Implementation phasing

If we land on the decisions above, the build is roughly:

### Phase A — wire what exists, add cron (1-2 days)
- Add `pg_cron` extension to Supabase (or Netlify Scheduled Functions, per D1)
- Schedule the supervisor-digest helper that already exists → fires Mon-Fri 7am AEST
- Add `check_overdue` trigger — fires when `due_date` passes (DB trigger, simple)
- Add `defect_raised` trigger — already exists in `lib/actions/defects.ts`? if not, two-line add
- Wire missing call sites for `check_completed` (currently misses some flows)

**Outcome:** every notification type currently *defined* in migration 0011 actually fires. Supervisor digest goes live. No new types yet.

### Phase B — pre-due reminders (1-2 days)
- New cron job: scan `maintenance_checks` where `due_date - now()` is in {14d, 7d, 1d}. Fire `check_due_soon` notification per row. Idempotency key prevents duplicate sends.
- New notification type added to migration: `check_due_soon`
- Email template per cadence (gentle 14d, polite 7d, urgent 1d)

**Outcome:** the highest-value missing notification is live.

### Phase C — customer-facing (commercial tier only) (3-4 days)
- New `notification_preferences` table + per-customer `customer_contacts.notification_settings` jsonb
- Admin UI on `/customers/[id]` to toggle per-customer notification settings
- New cron job: monthly summary (1st of month 7am)
- New cron job: upcoming-visit reminder (7 days out, customer contact)
- Audit table for outbound customer emails (`customer_notifications_log`)

**Outcome:** commercial-tier customers get the "we're in control of your sites" experience.

### Phase D — escalation, prefs UI, optional channels (variable)
- Per-user notification preferences page in `/settings`
- Critical-severity escalation logic
- (Optional) Twilio SMS integration for urgent
- (Optional) Slack/Teams webhook per tenant

**Outcome:** mature notification system with self-serve preferences.

---

## Recommended starting point

**Phase A first.** It's mostly wiring, no new architecture. Ships in a day.
The supervisor digest going live is the biggest single visible win — every supervisor in every tenant gets a useful 7am email.

After Phase A, **decide between Phase B (pre-due reminders) and Phase C (customer-facing).** They're roughly equal effort. Royce's call:
- Phase B if SKS NSW techs are missing scheduled work
- Phase C if commercial-tier customers (Linesight-shape) are the bottleneck for revenue

---

## Out of scope for this doc

- Sentry/error notifications — that's an ops-side thing
- Marketing emails (announcements, feature releases) — not transactional
- SMS / push to mobile app (no mobile app yet)
