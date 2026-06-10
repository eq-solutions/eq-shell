# EQ Solves — AI Strategy & Feature Roadmap

> Strategic plan for AI capabilities in EQ Solves PM platform.
> Grounded in real maintenance workflows, IBM Maximo AI patterns, and the existing data model.
> Created: 08 Apr 2026. Phasing reset: 12 Apr 2026 (post-Sprint 28).

## Status as of 12 Apr 2026

The original phasing (Sprint 23–25 for MVP AI) did not land. Sprints 23–28 went
into non-AI platform work: ACB/NSX testing rebuild, maintenance UX, reports
dashboard, PM calendar, defects register, site onboarding. All of that work is
now in production. The data model matured faster than the AI layer did, which
means Phase 1 features are easier to ship today than they would have been in
April — the tables, RLS policies, and action patterns they depend on all exist.

**Foundation shipped in the 12 Apr prep pass (ready to build on):**
- `withIdempotency()` wrapper + `mutation_id` column on `audit_logs` — every
  AI-suggested action is now replay-safe from day one (migration 0028).
- `lib/analytics/site-health.ts` — canonical compliance/site-health primitives.
  Any AI feature touching "site health" or "compliance rate" imports from here
  so the AI answer and the /reports answer never diverge.
- `CheckDetail.tsx` refactored into four components. AI suggestions in the
  check workflow (pre-job briefing, failure-code hints, photo-to-defect) have
  clean extension points instead of landing in a 550-line god component.
- Shared `ImageUpload` / `ImageThumbnail` / `ImageLightbox` components retained
  in `components/ui/` for future photo-to-defect capture (Phase 3).

## Revised phasing (from 12 Apr 2026)

**Build order change.** The original plan opened with the natural-language
query bar. On reflection, that's the highest-prestige feature but also the
highest-risk: translating user text into Supabase queries is a security-
sensitive pipeline, and if the first public AI feature is wrong once, users
stop trusting the whole layer. Leading with **Asset History Summary** gives us
a read-only, bounded, cacheable feature that proves the Claude API wiring and
the audit/idempotency pattern under low blast radius. NL query bar comes after
we've shipped two or three smaller features and know what the prompt / guard-
rail patterns should look like.

### Phase 1a — AI Foundation (next sprint)

| # | Feature | Effort | Value | Notes |
|---|---------|--------|-------|-------|
| 1 | Asset history summary | Low | High | Single-asset context, read-only, Claude Haiku. Ships the API client + audit + caching infra. |
| 2 | Check completion notes drafter | Low | Medium | Reuses Phase 1a infra. Draft on complete, tech edits before save. |
| 3 | Missing data flagging (dashboard card) | Low | High | Batch, scheduled nightly. No LLM needed for v1 — deterministic rules + AI only for the summary sentence. |

**Tech stack:** `@anthropic-ai/sdk`, server actions using the existing
`requireUser` → Zod → mutation → audit pattern, wrapped in `withIdempotency`
because AI features are exactly the scenario that benefits from replay safety.
Response cache keyed on `(entity_type, entity_id, entity_updated_at)` so edits
invalidate the cache automatically.

**Exit criteria:** 2 of 3 features shipped, tracked acceptance rate ≥ 40%, zero
audit log discrepancies.

### Phase 1b — NL query bar

Only after Phase 1a. Structured output → parameterised Supabase query → result
table. Explicit "query ran" display under every result. No free-text SQL —
the LLM outputs a constrained JSON schema that server-side code turns into a
supabase-js builder chain. Rate-limited per tenant.

### Phase 2 — Supervisor & Planning AI

Unchanged from original doc (site health scoring, repeat failure detection,
pre-job briefing, weekly site summary, smart check creation). Site health
scoring slots into the existing `lib/analytics/site-health.ts` module — the
composite score function already has a drop-in hook (`computeSiteHealthScore`)
ready to blend additional signals.

### Phase 3 — Field Technician AI

Unchanged from original doc. Photo-to-defect capture reuses the
`ImageUpload` / `ImageThumbnail` components in `components/ui/`. Voice-to-notes needs a new `audio_url` column on
`maintenance_check_items` (migration TODO).

### Phase 4 — Predictive & Advanced

Unchanged from original doc. Requires 12+ months of dense data, so earliest
practical start is mid-2027 given current check volume.

## Decisions log

- **12 Apr 2026** — Foundation pass shipped before any AI features. Idempotency,
  shared analytics, component split, items register, frequency editing. Rationale:
  cheaper to bake these in now than retrofit them across 5 AI features later.
- **12 Apr 2026** — Asset history summary chosen as first AI feature (was NL
  query bar). Rationale: lower risk, proves infra, builds user trust before
  the higher-stakes query translation.

---

---

## 1. Best AI Features for MVP

These are high-impact, realistic features to build first. They use data already in the platform and deliver immediate time savings.

- **Natural-language maintenance query bar** — A persistent AI search bar (separate from the existing keyword search) that understands questions like "show me overdue PMs at SY2", "which assets have failed inspections this quarter", "how many annual checks are still open". Translates natural language into Supabase queries against maintenance_checks, check_assets, maintenance_check_items, assets, and sites. Returns structured results, not chat-style prose. Users see the query the AI ran (transparency).

- **Asset history summary** — One-click "Summarise this asset" button on the asset detail page. Pulls the full maintenance check history, test results (ACB, NSX, general), defect/failure counts, and last 5 work orders for that asset. Generates a 3–5 sentence plain-English summary: "Asset 1006 (SY6-HV Main Switchboard A) has had 12 maintenance checks over 18 months, all passed. Last ACB test on 15 Mar 2026 passed. No repeat failures. Next annual PM due July 2026." This is what a tech or planner needs before attending a job.

- **Check completion notes drafter** — When a technician completes a maintenance check, AI drafts a completion summary from the pass/fail/NA results and any comments entered during the check. Instead of the tech writing "all good" or leaving it blank, the AI produces: "153 assets inspected. 148 passed all tasks. 3 assets had items marked N/A (spares — no physical equipment). 2 assets had failed items: Asset 1289 failed 'Check protective relay power/status' — comment: 'relay fault indicator lit, requires follow-up'." Technician reviews and edits before saving.

- **Missing data flagging** — Automated sweep that identifies maintenance checks missing work order numbers, assets missing job plan assignments, checks with no assigned technician, and overdue checks with no activity. Surfaced as an "AI Insights" card on the dashboard — e.g., "14 assets at SY6 have no job plan assigned", "3 checks are overdue with 0 tasks completed". Actionable: click through to the relevant filtered list.

- **Smart check creation suggestions** — When creating a new maintenance check, AI suggests: "SY2 has 47 assets due for annual checks this month. Last annual check was April 2025. Suggested: create annual check for SY2." Based on asset job plan frequency flags, last check dates, and the current month. Not auto-creating — just surfacing what's due.

- **Work order duplicate / similar detection** — When pasting Maximo work order numbers into a check, flag any assets that already have an open (scheduled/in_progress) check for the same frequency. Prevents double-handling.

---

## 2. Best AI Features for Supervisors and Planners

These features support people who plan, review, and manage maintenance programs.

- **Site health dashboard** — Per-site AI-generated health score (0–100) based on: % of PMs completed on time, repeat failure rate, average check completion time, overdue check count, defect rate from testing. Colour-coded (green/amber/red). Trend over 6 months. Helps supervisors prioritise which sites need attention this week.

- **Repeat failure detection** — AI scans maintenance_check_items for patterns: "Asset 1289 has failed 'Check protective relay power/status' on 3 of the last 4 checks." Surfaces these as alerts: "Repeat failure detected — consider rectification work order." Links to the asset and the specific failed items with dates.

- **PM interval optimisation suggestions** — For assets with long histories, AI analyses whether PM intervals are appropriate. "Asset class HV-DB-BLK at SY6 (7 assets) has had zero failures across 24 monthly checks. Consider extending to quarterly." Or conversely: "Asset 1289 has had 3 failures across 4 annual checks — consider increasing frequency to semi-annual." Supervisor reviews and accepts/dismisses.

- **Weekly site summary generator** — One-click generation of a site summary for a given week: checks completed, checks still open, failures found, rectifications raised, upcoming due dates. Formatted for email or export. Saves 30+ minutes of manual reporting per site per week.

- **Contractor / technician performance insights** — Which technicians complete checks fastest? Which have the highest failure-find rate (might indicate thoroughness, not poor performance)? Which sites have the slowest check turnaround? Presented as comparative insights, not leaderboards — framed for operational improvement.

- **Work order quality scoring** — AI reviews completed checks and flags those with low-quality data: checks where every item was marked pass in under 5 minutes (possible rubber-stamping), checks with no comments on failed items, checks where completion notes are empty or generic. Helps supervisors identify training needs.

- **Bulk check planning assistant** — "Plan the next quarter of maintenance for SY6" — AI looks at all assets, their frequencies, what's already scheduled, and generates a proposed batch creation plan with suggested dates and technician assignments. Supervisor reviews and approves.

---

## 3. Best AI Features for Field Technicians

These features help people doing the actual work on site.

- **Pre-job briefing** — "What do I need to know about this asset?" button on the check detail page. AI summarises: last maintenance date, any recent failures, known issues from previous check comments, any special notes. Saves the tech from scrolling through history. Delivered as 3–5 bullet points.

- **Voice-to-structured-notes** — Technician records a voice note on their phone: "Breaker A3 has a burnt contact on phase B. Thermal scan showed 85 degrees. Needs replacement within 30 days." AI transcribes and structures into: Asset: A3, Issue: burnt contact (phase B), Measurement: 85°C thermal, Priority: 30 days, Action: replacement required. Tech confirms and it's saved as a structured comment + suggested rectification.

- **Suggested failure/problem codes** — When a technician marks an item as "Fail", AI suggests likely failure codes based on the item description and historical failures for that asset type. "Previous failures on HV switchboard visual inspections were most commonly: burnt contacts (42%), loose connections (28%), corrosion (18%)." Tech selects or overrides.

- **Photo-to-defect capture** — Tech uploads a photo of a defect. AI describes what it sees: "Visible discolouration / heat damage on busbar connection. Appears to be arcing damage." Auto-populates a defect description. Tech reviews and edits. The photo and AI description are attached to the check item.

- **Repair step suggestions** — For failed items, AI suggests repair steps based on historical work orders for similar failures: "Previous repairs for 'protective relay fault' on this asset class involved: 1) Reset relay, 2) Check CT secondary wiring, 3) Replace relay module if reset fails. Average repair time: 2.5 hours." Sourced from completed check comments and work order history.

- **Smart task ordering** — For checks with 100+ items across many assets, AI suggests an efficient order based on asset location (group by switchboard room, then by row). Reduces walking time on large sites.

---

## 4. Advanced AI Features for Later Phases

These require more data maturity, integration, or ML infrastructure.

- **Predictive failure modelling** — Using 12+ months of maintenance and test data, build statistical models that predict which assets are most likely to fail in the next 30/60/90 days. Based on: failure frequency trends, asset age, environmental factors (site conditions), test result degradation (e.g., insulation resistance declining over time). Requires sufficient historical data — not viable until the platform has 12+ months of dense check data.

- **Asset health risk scoring** — Composite risk score per asset combining: age, failure history, test result trends, PM compliance, asset criticality (if defined). Visualised as a heatmap across sites. Used for capital replacement planning.

- **Anomaly detection on test readings** — For ACB and NSX tests with numerical readings (contact resistance, insulation resistance), detect when readings are drifting toward failure thresholds even if they still pass today. "Insulation resistance on Asset 1006 Phase A has declined from 1200 MΩ to 450 MΩ over 3 tests. Current threshold is 100 MΩ — projected to fail within 18 months at current rate."

- **Nameplate / asset plate OCR** — Technician photographs an asset nameplate. AI extracts: manufacturer, model, serial number, rating, year of manufacture. Auto-populates or validates asset register fields. Reduces data entry errors on commissioning.

- **Before/after inspection comparison** — Upload two photos of the same asset taken at different inspection dates. AI highlights visible changes: new corrosion, additional damage, repairs completed. Attached to the check record as evidence.

- **Parts and materials prediction** — Based on historical work orders and the tasks in an upcoming check, AI suggests likely spare parts needed: "Annual checks at SY6 historically require: 12x fuse links, 4x relay modules, 2x CT assemblies. Recommend pre-ordering." Requires parts/materials data (not yet in the schema).

- **Cross-site pattern detection** — AI identifies patterns across all sites: "HV switchboards from manufacturer X have a 3x higher relay failure rate than manufacturer Y across all sites." Useful for fleet-wide reliability decisions.

- **Natural-language work order creation** — "Create an annual maintenance check for SY6 due end of May, assign to Royce" — AI creates the check, finds matching assets, sets dates, assigns the technician. Full action, not just a query. Requires careful confirmation UX.

---

## 5. AI Actions / Workflow Automation Ideas

Beyond answering questions — AI that does things.

- **Auto-create rectification from failed inspection item** — When a tech marks a check item as "Fail" and adds a comment, offer: "Create a rectification work order for this?" AI pre-fills: asset, site, description (from the failed item + comment), priority (based on item criticality), suggested assignee (based on who usually handles this asset type). Supervisor reviews and approves.

- **Auto-escalate overdue checks** — If a check is 7+ days overdue with no activity, AI sends a notification to the assigned technician and their supervisor. If 14+ days overdue, escalates to admin. Configurable thresholds per site or frequency.

- **Draft defect report from check results** — After a check with multiple failures, AI generates a defect summary report: site, date, assets with failures, descriptions, photos, recommended actions. Formatted as a PDF or DOCX for sending to the customer (e.g., Equinix). Saves 1–2 hours of manual report writing.

- **Bulk reassignment** — "Reassign all of Royce's overdue checks at SY2 to another technician" — AI finds matching checks, shows a preview, supervisor confirms.

- **Smart scheduling** — When batch-creating checks for a quarter, AI balances workload across technicians based on: current assignments, historical completion rates, and site familiarity. Suggests a schedule that avoids overloading any one person.

- **Auto-populate work order numbers** — When a customer sends a spreadsheet of Maximo work orders, AI reads the spreadsheet, matches asset IDs to existing assets, and pre-fills the work order numbers on the check. Extends the existing paste-WO feature with file upload + smart matching.

- **Follow-up work order suggestions** — After check completion, AI reviews results and suggests follow-up actions: "3 assets had failed items. Suggest creating follow-up work orders for: Asset 1289 (relay fault), Asset 2338 (IR low), Asset 1278 (visual defect)." One-click to create each.

---

## 6. Risks, Guardrails, and Governance

- **Human-in-the-loop for all actions** — AI never creates, modifies, or deletes records without explicit user confirmation. Every AI-suggested action shows a preview and requires a click to execute. No silent writes.

- **Audit trail for AI actions** — Every AI-assisted action is logged in the audit_logs table with `action: 'ai_assist'` and metadata recording: what the AI suggested, what the user approved, and any edits made. Full traceability.

- **Confidence indicators** — AI suggestions show confidence levels where appropriate. "Suggested failure code: burnt contact (high confidence — 42% of similar failures)" vs "Suggested failure code: wiring fault (low confidence — 8% of similar failures)". Users can calibrate trust.

- **No silent overwrites** — AI pre-fills or suggests but never overwrites existing data. If a field already has a value, AI suggestions appear as alternatives, not replacements.

- **Predictive recommendations carry warnings** — Any predictive feature (failure prediction, interval optimisation) is clearly labelled: "AI Suggestion — review before acting. Based on historical data, not a guarantee." Predictive maintenance decisions in high-compliance environments (data centres) require human engineering judgment.

- **Data quality gating** — AI features degrade gracefully when data is sparse. If an asset has <3 historical checks, the AI says "insufficient history for reliable suggestions" rather than guessing. Prevents misleading recommendations on new assets.

- **Role-based AI access** — Technicians see task-level AI (pre-job briefing, failure code suggestions). Supervisors see planning AI (scheduling, site health). Admins see governance AI (quality scoring, audit). Read-only users see summaries only. AI capabilities respect the existing RBAC model.

- **Prompt injection protection** — Any AI feature that processes user-generated text (comments, notes, voice transcriptions) sanitises input before sending to the LLM. User content is treated as data, not instructions.

- **Cost management** — LLM API calls are metered. Expensive operations (full asset history summarisation, cross-site analysis) are rate-limited or batched. Dashboard insights are cached and refreshed on a schedule, not computed on every page load.

- **Compliance suitability** — For regulated environments (data centres, critical infrastructure), AI outputs are advisory only. The platform never auto-completes compliance-critical fields (test results, sign-offs) without technician action. AI-generated reports are clearly marked as AI-drafted.

---

## 7. Recommended Phased Roadmap

### Phase 1 — MVP AI (Sprint 23–25, ~2–3 weeks)

| Feature | Effort | Value |
|---------|--------|-------|
| Natural-language query bar | Medium | High — replaces complex filter navigation |
| Asset history summary | Low | High — immediate time savings for techs and planners |
| Missing data flagging (dashboard insights) | Low | High — improves data quality passively |
| Check completion notes drafter | Low | Medium — better records with less typing |
| Work order duplicate detection | Low | Medium — prevents double-handling |

**Tech stack:** Claude API (sonnet for queries, haiku for summaries), Supabase edge function or Next.js API route, structured output parsing, audit logging.

**Key decision:** Build the NL query bar as a server action that translates natural language → Supabase query → structured results. Not a chatbot — a smart search bar with table output.

### Phase 2 — Supervisor & Planning AI (Sprint 26–28, ~3 weeks)

| Feature | Effort | Value |
|---------|--------|-------|
| Site health scoring | Medium | High — prioritisation tool |
| Repeat failure detection | Medium | High — catches reliability issues |
| Pre-job briefing for techs | Low | High — field productivity |
| Suggested failure codes | Medium | Medium — data quality improvement |
| Weekly site summary generator | Low | Medium — reporting time savings |
| Smart check creation suggestions | Medium | Medium — planning efficiency |

**Tech stack:** Scheduled batch jobs for site health scores (daily), on-demand LLM calls for summaries and suggestions, cached insights.

### Phase 3 — Field Technician AI (Sprint 29–31, ~3 weeks)

| Feature | Effort | Value |
|---------|--------|-------|
| Voice-to-structured-notes | Medium | High — reduces on-site admin |
| Photo-to-defect capture | Medium | High — visual AI for inspections |
| Repair step suggestions | Medium | Medium — knowledge capture |
| Auto-create rectification from failure | Low | Medium — workflow speed |
| Draft defect report | Medium | Medium — customer reporting |

**Tech stack:** Whisper API or equivalent for voice transcription, Claude vision for photo analysis, structured output for defect classification.

### Phase 4 — Predictive & Advanced AI (Sprint 32+, ongoing)

| Feature | Effort | Value |
|---------|--------|-------|
| Test reading anomaly detection | High | High — early failure warning |
| PM interval optimisation | High | High — cost reduction |
| Asset health risk scoring | High | High — capital planning |
| Nameplate OCR | Medium | Medium — data capture |
| Cross-site pattern detection | High | Medium — fleet reliability |
| Predictive failure modelling | Very High | Very High — requires 12+ months data |

**Tech stack:** Statistical models (not necessarily deep learning — regression and threshold analysis may suffice for initial anomaly detection), scheduled batch processing, dedicated analytics database views.

### Implementation Principles

- **Start with retrieval, then generation, then action.** Phase 1 is mostly about finding and summarising existing data. Phase 2 adds generated insights. Phase 3 adds AI-triggered actions.
- **Every AI feature ships with an off switch.** Tenant settings should include AI feature toggles so customers can enable/disable specific capabilities.
- **Measure before scaling.** Track: AI suggestion acceptance rate, time saved per feature, data quality improvements. Kill features that users ignore.
- **Build the query layer first.** The natural-language query bar is the foundation — it forces you to build the structured data access layer that every other AI feature will use.

---

## Data Model Readiness

The existing schema is well-positioned for AI features:

| AI Feature | Required Data | Available? |
|------------|--------------|------------|
| NL query bar | All existing tables | Yes |
| Asset history summary | maintenance_checks, check_assets, maintenance_check_items, acb_tests, nsx_tests, test_records | Yes |
| Missing data flagging | assets, maintenance_checks, check_assets | Yes |
| Repeat failure detection | maintenance_check_items (result + check_asset_id across checks) | Yes |
| Site health scoring | maintenance_checks (status, dates), check_items (results) | Yes |
| Test reading anomaly detection | acb_test_readings, nsx_test_readings (value over time) | Yes |
| Voice notes | New field: audio_url on check items or check_assets | Needs migration |
| Photo defect capture | attachments table (already polymorphic) | Yes — extend with AI metadata |
| Failure codes | New table: failure_codes + FK on maintenance_check_items | Needs migration |
| Parts/materials | New table: parts, work_order_parts | Needs migration |
| Rectifications / defects | New table: rectifications (linked to check_items) | Needs migration |

---

## Competitive Positioning

This AI strategy positions EQ Solves as a Maximo-grade CMMS with modern AI capabilities that IBM charges enterprise prices for:

- **Maximo Assist** = our natural-language query bar + pre-job briefing
- **Maximo Work Order Intelligence** = our completion notes drafter + failure code suggestions + quality scoring
- **Maximo Visual Inspection** = our photo-to-defect capture + before/after comparison
- **Maximo Predict** = our anomaly detection + failure modelling (Phase 4)

The difference: EQ Solves delivers these at SME/mid-market price points, purpose-built for electrical contractors and data centre maintenance, not requiring a $500K+ Maximo implementation.
