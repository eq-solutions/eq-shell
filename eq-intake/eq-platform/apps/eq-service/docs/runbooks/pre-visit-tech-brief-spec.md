# Pre-visit tech brief — captured spec

**Source**: design doc at `C:\Users\EQ\OneDrive - eq-power.com.au\Desktop\pre-visit-brief.html`, decisions exported 2026-05-13.

Night-before email to the assigned technician with full visit context: site, access notes, contact, asset count, scope, run-sheet attachment, and a calendar invite.

---

## Status 2026-05-14

**Phase 0 SHIPPED** — migration 0096 applied to production (added `scheduled_start_at` column + backfilled `assigned_to = created_by` on scheduled-but-unassigned rows; backfill was a no-op against current data since all 9 such rows had `created_by IS NULL`). Server-action enforcement live in `createCheckAction`, `updateCheckAction`, `batchCreateChecksAction` — `status='scheduled'` requires non-null `assigned_to`. PR #118.

**Phase 1 scope locked** (Royce, 2026-05-14):
- ✅ **v1 INCLUDES all three enrichment blocks**: `prior_visit_summary`, `last_visit_report` attachment, `weather`. (Source doc marked the latter two as Phase 2/3; Royce confirmed they ship in v1.) Adds ~2 days to Phase 1 sprint vs original estimate.
- ✅ **Backfill default**: `assigned_to = created_by` — DONE in migration 0096.
- ✅ **Visit-start-time UI**: inline editable field on `/maintenance/[id]` header.
- ✅ **Send brief button**: on `/maintenance/[id]` only (admin/supervisor visible).
- ⏳ **Reschedule threshold** (1hr movement): not yet locked. Defer to Phase 2 implementation time.

**Phase 1 effort revised**: 4-5 days of focused work (was 2-3 in original estimate — bigger because of enrichment blocks). Phase 2 effort drops because cron is now the only Phase 2 deliverable.

**Still parked**: Phase 3 items (SMS, multi-tech, customer email, "running late") unchanged.

---

## Locked-in decisions (Royce, 2026-05-13)

| # | Question | Choice | Notes |
|---|---|---|---|
| 1 | When brief fires | 17:00 day before | "Keep it manual for now" — see Phase ordering below |
| 2 | Visit start time source | Add nullable `scheduled_start_at` column, fall back to 08:00 tenant tz | |
| 3 | Channels v1 | email + in-app bell | SMS deferred |
| 4 | Subject format | Full: "Tomorrow 07:00 — Greystanes — 47 assets (Switchboard PPM)" | |
| 5 | Email body blocks | visit_details · map_link · site_contact · access_notes · scope_summary · asset_count · tech_notes · coordinators · deep_link · prior_visit_summary · weather | Source doc marked prior_visit_summary as Phase 2 and weather as Phase 3 — flagged for Phase split |
| 6 | Attachments | runsheet_docx · ics · last_visit_report | last_visit_report was Phase 2 in source — flagged for Phase split |
| 7 | ICS shape | Tech as attendee, tenant as organizer; 4hr default duration; 60min + 15min popup reminders | |
| 8 | Opt-out | Default ON — tech must opt out | |
| 9 | `assigned_to` gap | Require `assigned_to` when status moves to `scheduled` + backfill existing scheduled rows | THIS IS THE BLOCKER. Has to ship first. |
| 10 | Reschedule | Resend on change (>1hr movement); send ICS CANCEL on cancel | |
| 11 | Multi-tech | Defer to Phase 2 — v1 supports one assignee | |
| 12 | Customer-facing brief | Out of scope — separate track | |
| 13 | Settings UI | Extend existing `/settings/notifications` | |

## Phased shipping order

The captured decisions, when read together, imply three phases (not one). Build sequence:

### Phase 0 — Prerequisites (no brief logic, just unblocking)
1. **Migration** — add `maintenance_checks.scheduled_start_at timestamptz NULL`
2. **Server action enforcement** — `setStatusAction` (or equivalent) rejects `scheduled` status without `assigned_to`. Zod schema enforces. Error surfaces inline.
3. **Backfill migration** — for existing rows where `status='scheduled' AND assigned_to IS NULL`, set `assigned_to = created_by` (supervisor fallback). Audit log entry per row so the change is traceable.
4. **UI prompt** — on `/maintenance/[id]`, if status=scheduled and no assignee, banner with "Assign technician" link.

**Without Phase 0, the brief feature is unshippable** — there's nothing to send to. Separate PR, separate review, must land first.

### Phase 1 — Brief feature, manual trigger (REVISED 2026-05-14: enrichment blocks pulled in)
1. **Brief composer** (`lib/notifications/pre-visit-brief.ts`) — pure function that takes a check_id and returns `{ subject, htmlBody, plainBody, icsContent, runsheetDocx, lastVisitReportDocx? }`.
2. **`scheduled_start_at` inline editor** — on `/maintenance/[id]` header, inline-edit pattern matching the WO and notes cells.
3. **Email template** — server-rendered. Blocks: visit_details, map_link, site_contact, access_notes, scope_summary, asset_count, tech_notes, coordinators, deep_link, **prior_visit_summary**, **weather**.
4. **`prior_visit_summary` block** — query last completed check at same site, surface defects raised + tests failed.
5. **`weather` block** — BoM API (Australia) for the site lat/lon. Cache result for the day to avoid rate limits.
6. **ICS generator** — single VEVENT, RFC 5545. Tech as ATTENDEE, tenant as ORGANIZER. DURATION=4h default. VALARM 60min + 15min before.
7. **Run-sheet DOCX attachment** — call existing `/api/maintenance-checklist?format=standard` server-side, attach to email.
8. **`last_visit_report` attachment** — call `/api/pm-asset-report` for last completed check at same site, attach.
9. **"Send brief" button** — on `/maintenance/[id]` only (admin/supervisor visible). Calls a server action that runs the composer + dispatches via existing notifications pipeline.
10. **Bell notification** — same trigger fires an in-app notification with deep link.
11. **Opt-out** — add `pre_visit_tech_brief` as an event type in `notification_preferences.event_type_opt_outs`. Default ON. Surface in `/settings/notifications`.
12. **Audit log** — every send writes to `audit_logs` with mutation_id so re-clicks are idempotent.

### Phase 2 — Cron automation (smaller now)
1. **Cron at 17:00 day-before** — fires `pre_visit_tech_brief` for every scheduled check where `scheduled_start_at = tomorrow_in_tenant_tz` AND `pre_visit_brief_sent_at IS NULL`.
2. **Reschedule handling** — when `scheduled_start_at` changes by >1hr, reset `pre_visit_brief_sent_at` so cron re-fires. ICS CANCEL on cancellation.

### Phase 3 — Phase 2 deferrals from the source doc
- SMS channel (own build, ~$0.06/SMS AU via Twilio)
- Multi-tech assignees (`maintenance_check_assignees` junction table)
- Customer-facing pre-visit email upgrade
- "Running late" tech-initiated notification

---

## Open questions (flag in morning)

1. **Phase 2 blocks intentionally in scope?** — `prior_visit_summary`, `last_visit_report`, `weather` were Phase 2/3 in source but ticked in decisions. Confirm whether they ship with Phase 1 (bigger sprint) or defer (smaller, faster v1).
2. **Manual-trigger framing** — does "Send brief" button live admin-only on `/maintenance/[id]`, or also on `/pm-calendar` per-event? Latter is more discoverable for supervisors planning a week.
3. **Backfill default for `assigned_to`** — `created_by` is the obvious fallback but in practice supervisors may not be the right next-week tech. Alternative: leave null + force UI ask before transitioning to `scheduled`.
4. **Reschedule threshold** — 1hr movement triggers resend. Is that right? Too low → spam on minor edits; too high → tech misses real change.
5. **Visit-start-time UI** — where does the tech-onsite or supervisor SET `scheduled_start_at`? Inline on the check page, or in a new "schedule" modal? Probably inline.

---

## What this build is NOT

- Not an SMS channel
- Not a "running late" notification from the tech
- Not the customer-facing pre-visit email (separate track)
- Not multi-tech assignment (Phase 2 schema change)
- Not a weather-API integration in v1

---

## Estimated effort (rough)

- **Phase 0**: 0.5 day (one migration, one action change, one backfill)
- **Phase 1**: 2-3 days (composer + email + ICS + DOCX attach + button + opt-out + bell notification + audit)
- **Phase 2**: 1-2 days (cron + 3 enrichment blocks + reschedule handling)

Total **3.5-5.5 days** of focused work for a fully wired feature. Phase 1 alone is shippable and delivers most of the value if Phase 2 is parked.

---

## Original decisions JSON

```json
{
  "trigger_time": {
    "choice": "day_before_1700",
    "notes": "Lets just keep it manual for now"
  },
  "start_time_source": {
    "choice": "add_column_fallback_0800"
  },
  "channels": {
    "selected": ["email", "bell"]
  },
  "subject_format": {
    "choice": "full"
  },
  "email_blocks": {
    "selected": [
      "visit_details", "map_link", "site_contact", "access_notes",
      "scope_summary", "asset_count", "tech_notes", "coordinators",
      "deep_link", "prior_visit_summary", "weather"
    ]
  },
  "attachments": {
    "selected": ["runsheet_docx", "ics", "last_visit_report"]
  },
  "ics_shape": {
    "choice": "tech_as_attendee",
    "notes": ["4 hours", "60, 15"]
  },
  "optout": {
    "choice": "default_on"
  },
  "assigned_to_gap": {
    "choice": "require_on_scheduled"
  },
  "reschedule": {
    "choice": "resend_on_change"
  },
  "multi_tech": {
    "choice": "phase2"
  },
  "customer_brief": {
    "choice": "separate_track"
  },
  "settings_surface": {
    "choice": "existing_notif_settings"
  }
}
```

---

## History

| Date | Event |
|------|-------|
| 2026-05-13 | Spec captured from HTML design doc, decisions locked. Build deferred to morning session. |
