# Competitive feature audit — 2026-05-19

> Research-only. Pre-go-live look at what successful competitors do that eq-service doesn't, what's table stakes, and where eq-service can differentiate. No code changes proposed here — this is a positioning and prioritisation document for Royce ahead of launch.

## 1. TL;DR

eq-service is a **CMMS with a trades-platform veneer**, not a tradie-jobs platform with maintenance bolted on. It already does the hard things (asset hierarchy, tenant-scoped/customer-scoped job plans, RCD per-circuit timing, ACB protection-setting matrix, kind-aware unified `maintenance_checks`, Maximo Delta multi-file import with consolidation) better than the trades tools, and it does the easy things (quoting, invoicing, dispatch) not at all.

**Top 3 gaps that matter for go-live:**

1. **Scheduling / dispatch board** — every competitor has a drag-and-drop calendar that assigns technicians to jobs and shows the day's run. eq-service has a PM calendar and a check list but no "today's run for Dave" view. This is the single most asked-for thing in CMMS reviews.
2. **Mobile-first work-order completion** — eq-service is responsive web, not an installable app with offline support. Field techs at Equinix data halls have weak signal; "I lost my session walking between rooms" is a real complaint to pre-empt.
3. **Quote/estimate → job conversion** — variations and contract-scope changes get tracked, but there is no "quote the customer for a defect repair, get acceptance, convert to a job" flow. simPRO and Tradify both rely on this as their core value loop.

**Top 3 differentiation angles (already real, deepen these):**

1. **Compliance-grade reporting** — RCD per-circuit timing tables, ACB protection settings, customer-facing docx with cover/sign-off. None of the trades tools come close to AS/NZS 3760 evidence quality; some of the CMMS tools have it generically but not for electrical.
2. **Maximo / enterprise-import fluency** — Maximo Delta WO consolidation, multi-tab Jemena RCD xlsx. Most competitors require manual data entry or charge for "integration consulting".
3. **Three-tier job plan model** (global / customer-scoped / site-scoped). Lets a contractor like SKS service both an enterprise customer (Equinix Maximo conventions) and a mid-market customer (Jemena bespoke plans) without forking the tenant.

**Top 3 to NOT chase:**

1. **Full CRM / sales pipeline** (ServiceTitan, AroFlo). The customer for eq-service is the contractor's *technician*, not their sales team. Sales lives in HubSpot / Pipedrive elsewhere.
2. **In-app payments / merchant accounts** (Tradify, Fergus, ServiceTitan). Australian electrical contractors invoice through Xero/MYOB; chasing a Stripe-merchant relationship duplicates accounting workflow with no obvious lift.
3. **Generic marketplaces** (Limble's parts marketplace, UpKeep's vendor directory). Sub-scale and a regulatory minefield in AU where licensed-trade rules apply.

## 2. Market positioning

The trades-platform vs CMMS distinction matters because they target different buyers:

| Axis | Trades platforms (simPRO, Tradify, AroFlo, ServiceTitan, Fergus) | CMMS (Limble, UpKeep, MaintainX, Maximo) |
|---|---|---|
| **Buyer** | Owner / office manager of trades business | Facilities / reliability manager of asset owner |
| **Core loop** | Quote → schedule → invoice → get paid | PM schedule → work order → asset health → uptime |
| **Asset model** | Customer property, lightweight | Asset hierarchy, deep |
| **Compliance** | Test-and-tag bolt-on | First-class for regulated industries |
| **Pricing** | A$30–A$80/user/month | A$45–A$200/user/month, often per-asset tiers |
| **Field UX** | Mobile-first, often installed app | Mobile-first, often QR-code asset scan |
| **Customer-facing artefacts** | Branded quotes/invoices | Compliance reports |

**eq-service today is structurally a CMMS** (asset hierarchy → job plan → check → test → report) **sold to a trades business** (SKS Technologies) **whose customers include enterprise asset owners** (Equinix, Jemena). The first-tenant pattern is unusual: SKS is the contractor, Jemena is a customer-and-tenant. That tells me the sweet spot is **CMMS-shaped, multi-party** — closer to MaintainX than to simPRO, but with the trades workflows (variation pricing, contract-scope tracking) that pure CMMS skip.

The strategic question is whether to *deepen the CMMS side* (Limble/MaintainX-grade asset health, PM compliance, inspections) or *broaden into trades-platform territory* (simPRO-grade quote→job→invoice). For go-live the answer is **deepen CMMS, ignore the trades-platform path** — the customers eq-service is winning (data centres, utilities, healthcare) buy on compliance and audit-trail, not on quoting elegance.

## 3. Per-competitor breakdowns

### 3.1 simPRO

Australian, founded 1999 in Brisbane, electrical-contractor heritage. Closest comparator to SKS's *contractor* shape, but has no concept of running a customer as a tenant. Pricing: Essential / Core / Premium / Enterprise; user-priced, ~A$70–A$100/user/month at Core ([simPRO pricing](https://www.simprogroup.com/au/pricing)).

**Standout features:**

1. **Connected estimating with assembly templates** — pre-built assemblies (e.g. "20A switchboard upgrade") roll labour + parts + markup into a quote in minutes. *Not in eq-service (no quoting). Scope: L — needs item master, labour rate model, markup rules.*
2. **Scheduling board with drag-and-drop dispatch** — daily/weekly grid, tech-as-row, jobs as draggable blocks. *Not in eq-service (PM calendar shows due-dates, not assigned-runs). Scope: M — `technician_assignments` model + calendar UI.*
3. **Recurring jobs / PM contracts** — auto job creation on a schedule with auto-billing. *Partial — `pm_calendar` exists and Delta imports auto-create checks, but no billing tie-in. Scope: M for full match; S for "auto-create draft check from pm_calendar entry on a cadence".*
4. **Connected mobile app with offline mode** — installable iOS/Android with queue + sync. Solves the data-hall basement signal problem. *Not in eq-service (responsive web only). Scope: L if native; M if a strong PWA with service-worker queue.*

Most-praised in G2/Capterra reviews: estimating depth, asset register for service-contract customers. Most-criticised: steep learning curve, "feels enterprise-y for a 3-person sparkie", expensive at the Premium tier.

### 3.2 ServiceTitan

US-based, founded 2007, IPO'd 2024. Targets larger residential trades (HVAC, plumbing, electrical). Heaviest feature set on this list. Pricing is quote-only; reportedly starts around US$398/tech/month ([Software Advice ServiceTitan](https://www.softwareadvice.com/field-service/servicetitan-profile/)) — needs confirmation.

**Standout features:**

1. **Call-booking + dispatch with built-in call recording** — pops customer history on inbound call, records for QA, routes to dispatch. Solves: residential trades where 60% of work is inbound phone. *Not in eq-service. Scope: L; not worth chasing — eq-service customers don't book by phone.*
2. **Marketing / ads attribution** — tracks which Google Ads campaign produced which booked job. *Not relevant to eq-service customer base. Scope: not in scope.*
3. **Pricebook with good/better/best presentation** — tech presents three repair tiers on a tablet; customer picks one. Solves: in-home upsell. *Not in eq-service. Scope: L and questionable for B2B electrical maintenance.*
4. **Dispatch board with capacity heatmap** — shows under/over-booking by skill type. *Not in eq-service. Scope: M as a stretch goal, after a basic schedule board exists.*

Most-praised: integrated phone + CRM + dispatch + invoicing in one pane, reporting depth. Most-criticised: cost, US-centric workflows, 12-week implementation, expensive add-ons.

### 3.3 Tradify

NZ-origin, simpler tool, strong in the Australian sparkie market for solo and 2-5 tech businesses. Pricing flat A$42/user/month ([Tradify pricing](https://www.tradifyhq.com/pricing)).

**Standout features:**

1. **One-screen job card with quote → invoice on the same record** — single object holds quote, schedule, timesheets, invoice, photos. *Not in eq-service (no quote/invoice). Scope: L if matching; eq-service is structurally bigger — Tradify's win is *fewer* features.*
2. **Xero / MYOB / QuickBooks two-way sync** — invoice raised in Tradify posts to Xero; payment comes back. *Not in eq-service. Scope: M once an invoice model exists; S as one-way export of variations / timesheets.*
3. **Quotes with Stripe-link "approve and pay deposit"** — customer email contains accept button; click locks the quote, optionally captures deposit. *Not in eq-service. Scope: M, tied to a quoting module that doesn't exist.*
4. **In-app email/SMS to customer from the job card** — tech taps "I'm on my way"; message logs against the job. *Not in eq-service (no SMS provider). Scope: S if Twilio is wired in; `contacts` model already supports it.*

Most-praised: simplicity, mobile polish, fair pricing. Most-criticised: hits a ceiling at ~10 techs, weak custom reporting, no real asset management.

### 3.4 AroFlo

Australian, mid-market, strong in HVAC and large electrical. Pricing roughly A$72/user/month ([AroFlo pricing](https://aroflo.com/aroflo-pricing)).

**Standout features:**

1. **Compliance forms builder** — drag-and-drop form designer for tech tablets, with conditional logic, signature blocks, and embed-in-PDF output. Solves: every customer wants their own checklist. *Partial in eq-service — `maintenance_check_items` are derived from job plans but the *structure* is hard-coded (status + comment). No conditional logic, no signature blocks. Scope: M to add form-builder primitives.*
2. **GPS tracking of vehicles** — knows where each tech is on a map. Solves: dispatch decisions, customer ETA. *Not in eq-service. Scope: L (privacy + hardware); strategically questionable for SKS use case where techs are static on a Equinix site for a day.*
3. **Inventory across vehicles + warehouse** — track a contactor across "van 4", "main store", "site 7". Solves: stop the "where is the spare 100A breaker?" search. *Not in eq-service. Scope: L; possibly relevant once eq-service moves into defect-repair workflow.*
4. **Customer portal with quote acceptance + invoice payment** — a portal customers actually use. Solves: reducing inbound email volume. *Partial in eq-service — `(portal)` route group exists with visits / scope / variations / defects views. No payments. Scope: S to broaden to more entities; M for payments.*

Most-praised: customisation depth, strong on compliance forms. Most-criticised: dated UI, slow on mobile, expensive once add-ons stack up.

### 3.5 Fergus

NZ-origin, owner-friendly, simpler than simPRO. Pricing around A$49/user/month ([Fergus pricing](https://fergus.com/pricing)).

**Standout features:**

1. **Status board ("the wall")** — kanban of every job by stage (quoted / accepted / scheduled / in progress / invoiced). Solves: "what state is everything in right now?" at a glance for the owner. *Not in eq-service (no equivalent overview). Scope: S as a dashboard widget over existing checks; M as a richer kanban over jobs.*
2. **Health-check dashboard** — auto-surfaces stale quotes, overdue invoices, missing time entries. Solves: things falling through cracks. *Not in eq-service. Scope: S — eq-service's `audit_logs` + scheduled queries can produce most of these signals.*
3. **Backcosting** — labour-hours-actual vs labour-hours-quoted per job, with margin reports. Solves: contractor knowing whether each job actually made money. *Not in eq-service (no quote model). Scope: M once quoting exists.*
4. **One-page job hand-over to customer** — single PDF with photos, work done, materials, signed-off. Solves: "what did you actually do today?" *Partial — eq-service Customer Report covers this for PPM/testing, but not for ad-hoc service work. Scope: S to extend the existing docx generator to non-PPM check kinds (already kind-aware).*

Most-praised: owner-focused dashboards, NZ/AU centric. Most-criticised: tech mobile app weaker than the office UI, integrations limited.

### 3.6 Limble CMMS

US-based, founded 2015, very strong G2 ratings on mobile-first CMMS. Pricing tiers: Free (single user) / Starter US$28 / Standard US$69 / Premium+ US$199 per user per month ([Limble pricing](https://limblecmms.com/pricing/)).

**Standout features:**

1. **QR-code asset scan to open PM** — sticker on the asset, scan with phone camera, jump straight to that asset's PM history + create a work order. Solves: walking up to an unknown asset and not knowing what to do with it. *Not in eq-service. Scope: S — assets already have UUIDs, just need a QR sticker generator and a `/scan/[id]` route.*
2. **Asset criticality scoring with cost-of-downtime tracking** — every asset has a $-per-hour-down number; reports surface downtime impact. Solves: "which asset to fix first." *Not in eq-service. Scope: M; useful for data-centre customers but not for tester-bench world.*
3. **Vendor management with PO and parts ordering** — issue a PO to a vendor when stock runs low; track receipt. Solves: parts-ops workflow. *Not in eq-service. Scope: L; mostly not in eq-service's lane.*
4. **Predictive PM via sensor integration** — IoT sensor data triggers a work order when a threshold is hit. Solves: condition-based maintenance vs time-based. *Not in eq-service. Scope: L; possible long-term, currently not realistic.*

Most-praised: mobile UX, simple setup, great free tier for evaluation. Most-criticised: reporting could be deeper, weak at multi-site / multi-tenant once you scale up.

### 3.7 UpKeep

US-based, mobile-first CMMS, founded 2014. Pricing tiers: Lite US$45 / Starter US$75 / Professional US$120 per user per month ([UpKeep pricing](https://www.onupkeep.com/pricing)).

**Standout features:**

1. **In-app messaging tied to work orders** — chat thread on every WO, with @mention, file attach, read-receipts. Solves: tech-to-tech and tech-to-office "did you see the WO update?" without email/Slack ping-pong. *Not in eq-service. Scope: M; nice-to-have not table-stakes.*
2. **Meter readings and meter-based PMs** — record meter readings (run hours, kWh), trigger PMs at thresholds. Solves: hour-based servicing of generators / chillers. *Partial in eq-service — `acb_tests` has an op_counter field but there's no meter-trigger model. Scope: M.*
3. **Public work-order request portal** — anyone (not a logged-in user) can submit a WO request via a public link; goes into a triage queue. Solves: tenants/staff reporting issues without an account. *Not in eq-service. Scope: S to M — leverage the existing brief intake pattern.*
4. **Cost tracking per WO** — labour hours × rate + parts cost rolled up. Solves: "what did each WO cost us." *Not in eq-service. Scope: M; depends on the labour-rate model.*

Most-praised: mobile-first UX, request portal. Most-criticised: UI feels cluttered as you scale, reporting is shallow without paying for higher tiers.

### 3.8 MaintainX

US-based, founded 2018, modern UI heavily influenced by consumer apps. Pricing: Basic free / Essential US$16 / Premium US$49 / Enterprise quote ([MaintainX pricing](https://www.getmaintainx.com/pricing)).

**Standout features:**

1. **Procedure library with conditional steps + photo evidence required** — checklist with "if X fails, force a photo and a comment". Solves: forcing compliance evidence at the point of work. *Partial in eq-service — `maintenance_check_items` track status + comment but don't force photo evidence per item, only at the check level. Scope: S — `attachments` already supports per-check; extend to per-item.*
2. **Live multi-language UI (10+ languages)** — switches the entire app on the user's language preference. Solves: subcontractor + migrant workforce. *Not in eq-service. Scope: M (next-intl integration); strategic value low until eq-service has multi-country tenants.*
3. **Asset lifecycle: purchase → maintenance → retirement with cost-to-date** — tracks total cost of ownership through to end-of-life. Solves: capital-replacement decisions. *Not in eq-service. Scope: M; relevant to FM-side customers like Jemena.*
4. **Public API + Zapier connector** — automate "new defect → Slack channel" or "WO completed → custom DB". Solves: integration without a vendor build. *Not in eq-service. Scope: M — eq-service has server actions that could expose a generated public API; Zapier app is its own build.*

Most-praised: fastest-to-value setup, modern UI, generous free tier. Most-criticised: reporting feels light at the Essential tier; some heavy users complain it doesn't scale to enterprise complexity.

### 3.9 IBM Maximo

The reference point — what Equinix runs. Enterprise EAM (Enterprise Asset Management), licensing typically 5-6 figures per year per site ([IBM Maximo](https://www.ibm.com/products/maximo)). Self-hosted or IBM Cloud.

**Standout features:**

1. **Failure-codes hierarchy (cause / remedy / problem)** — every WO close-out tags the root cause from a controlled vocabulary. Solves: trending "which fault occurs most across the fleet". *Not in eq-service — defects has free-text. Scope: M; very high-value for compliance customers.*
2. **Calibration management with traceability to standards** — instrument has a calibration certificate chain back to NATA / NIST. Solves: regulator audit trail. *Partial — eq-service has an `instruments` model. Scope: S to add cert upload + expiry alerts.*
3. **Operational analytics — MTBF / MTTR per asset class** — fleet-level reliability metrics. Solves: maintenance manager's quarterly report. *Not in eq-service. Scope: M; the data is already in `maintenance_checks` + `defects`, just needs the report.*
4. **Permit-to-work and lockout/tagout workflow** — formal permit issuance, isolation checklist, sign-off before work starts. Solves: safety compliance in regulated environments. *Not in eq-service. Scope: L; potentially differentiating for data-centre and utility customers.*

Most-praised: depth, regulator acceptance, customisability. Most-criticised: heavy, slow to change, expensive, customer needs IBM consultants to make any change. Eq-service's competitive position vs Maximo is **simplicity at the contractor-fronting layer** — the customer keeps Maximo as their book-of-record, eq-service is the layer the contractor's technician uses.

## 4. Feature-gap matrix

Legend: ✅ supported · ◐ partial · ✗ not supported · n/a not in scope.

| Feature | simPRO | STitan | Tradify | AroFlo | Fergus | Limble | UpKeep | MaintX | Maximo | **eq-service** |
|---|---|---|---|---|---|---|---|---|---|---|
| Quoting / estimating | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Quote-to-job conversion | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Scheduling / dispatch board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ (PM calendar) |
| Mobile field app (installable) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ (responsive web) |
| Offline mode + sync queue | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✗ |
| Customer portal | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | ◐ (request) | ◐ | ✅ | ◐ (visits / scope / variations / defects) |
| Asset hierarchy (multi-level) | ◐ | ✅ | ✗ | ◐ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ |
| QR / barcode asset scan | ✅ | ✅ | ◐ | ✅ | ✗ | ✅ | ✅ | ✅ | ✅ | ✗ |
| PM scheduling (time-based) | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PM scheduling (meter-based) | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ✗ |
| Work order full lifecycle | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Defect / fault tracking | ◐ | ◐ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Failure codes (controlled vocab) | ✗ | ◐ | ✗ | ◐ | ✗ | ◐ | ◐ | ◐ | ✅ | ✗ |
| Compliance / regulatory reports | ◐ | ◐ | ✗ | ✅ | ✗ | ◐ | ◐ | ◐ | ✅ | ✅ (RCD / ACB / NSX) |
| Inventory / parts | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✗ |
| Time tracking (clock in/out) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ |
| Invoicing / payments | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ◐ | ✗ |
| Xero / MYOB / QuickBooks sync | ✅ | ◐ | ✅ | ✅ | ✅ | ✗ | ◐ | ◐ | ◐ | ✗ |
| Subcontractor management | ✅ | ✅ | ◐ | ✅ | ◐ | ◐ | ◐ | ◐ | ✅ | ✗ |
| Equipment / tool tracking | ◐ | ✅ | ✗ | ✅ | ✗ | ◐ | ◐ | ✗ | ✅ | ◐ (instruments) |
| Customer SMS / email automation | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✅ | ✅ | ◐ | ◐ (email digest) |
| AI / automation features | ◐ | ✅ | ◐ | ◐ | ✗ | ◐ | ◐ | ✅ | ◐ | ◐ (Sentry / Seer; no in-app AI) |
| Public API | ✅ | ✅ | ◐ | ◐ | ✗ | ✅ | ✅ | ✅ | ✅ | ✗ |
| Multi-tenant / white-label | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✅ |
| Customer-scoped configuration | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✅ |
| Form / checklist builder | ◐ | ✅ | ◐ | ✅ | ✗ | ✅ | ✅ | ✅ | ✅ | ◐ (job-plan items, no conditional) |
| Photo evidence required | ◐ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ◐ (at check level only) |
| Permit-to-work / LOTO | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ◐ | ✅ | ✗ |
| Calibration / test-instrument certs | ✗ | ✗ | ✗ | ◐ | ✗ | ◐ | ◐ | ◐ | ✅ | ◐ (instruments table) |
| Enterprise import (Maximo / CSV) | ◐ | ◐ | ✗ | ◐ | ✗ | ✅ | ✅ | ✅ | n/a | ✅ (Maximo Delta + RCD xlsx) |

The pattern: eq-service is **ahead** on multi-tenant + customer-scoped configuration + compliance + enterprise imports, **at parity** on asset hierarchy + PM + work orders + defects + portal, and **behind** on quoting / invoicing / scheduling / mobile-app / inventory / time-tracking / integrations / form-builder polish.

The behind list is mostly *trades-platform features* that don't move the needle for the actual customers (data centres want a compliance partner, not a quote-and-invoice partner). The exception is **scheduling / dispatch board** and **mobile field UX** — every type of competitor has these because every type of customer needs them.

## 5. Table-stakes features eq-service is missing

These are present in 7+ of the 9 competitors. Going to market without them is conspicuous.

### 5.1 Drag-and-drop scheduling / dispatch board

**What:** A board view showing each technician as a column or row and each day's worth of scheduled checks as cards. Drag a check between techs to reassign, drag along the time axis to reschedule.

**Why all competitors have it:** Every contractor with more than one tech needs a "who is doing what today" view. The PM calendar in eq-service shows *what is due* not *who is doing it*; there is no `technician_id` on `maintenance_checks` today.

**Impact on launch if missing:** SKS NSW has approx 8 techs at peak. They have been managing dispatch in a spreadsheet. The first customer demo will ask "where do I assign Dave to today's run?" and the answer "you don't, you give him a list" is awkward.

**Rough cost to add (S/M/L):** **M.** Schema: `assigned_to_user_id` on `maintenance_checks` (already may exist; needs check). UI: new `/schedule` route showing a weekly grid. Backend: small RPC to list assignments by tech and date range. About 1.5–2 weeks.

### 5.2 Installable mobile app with offline support (PWA route)

**What:** Service-worker-based PWA that installs to the home screen, queues mutations when offline, syncs when signal returns.

**Why all competitors have it:** Field techs lose signal. Data-hall basements, plant rooms, regional sites. Every CMMS review on G2 either praises or criticises the offline story.

**Impact on launch if missing:** Two failure modes. (1) Tech loses an hour of work walking between halls because the session expired. (2) Tech blames the app on every signal issue; the app gets a reputation.

**Rough cost to add (S/M/L):** **M.** Next.js 16 supports manifest + service-worker. The harder part is making server actions idempotent enough to replay safely (`withIdempotency()` is already the project pattern, per AGENTS.md). 2–3 weeks for a solid PWA with queued mutations on the most-used flows (check item updates, defect creation, attachment upload).

### 5.3 QR-code asset scan to open the asset / check

**What:** Sticker on each asset with a QR code; scanning opens the asset record + creates-or-opens the latest open check.

**Why all competitors have it:** It is the single highest-value "feels modern" feature for field techs. Removes the entire navigation problem.

**Impact on launch if missing:** Loses to Limble / UpKeep / MaintainX in any side-by-side demo. Equinix techs are used to Maximo's barcode reader workflow already.

**Rough cost to add (S/M/L):** **S.** Each asset has a UUID. A `/a/[id]` short route that resolves to the asset detail (or to "create check for this asset"). A QR-sticker bulk-print page in admin. About 3–5 days, no schema change.

### 5.4 Conditional checklist items + per-item photo evidence

**What:** When an item fails, the next item appears with a forced photo + comment. Conditional branches ("if breaker brand = ABB, show these checks").

**Why all competitors have it:** AroFlo's whole selling proposition is its forms builder. MaintainX's procedures are conditional. Equinix asks for this in tender responses.

**Impact on launch if missing:** Bigger customers (DC operators, healthcare) write SOPs as flowcharts. They expect their flowcharts to be encodable in the tool.

**Rough cost to add (S/M/L):** **M.** Schema: `maintenance_check_items.failure_action` (`photo` / `comment` / `branch`); `job_plan_items.parent_item_id` + `parent_outcome` for branching. UI: form-builder admin + tech-facing renderer. 1.5–2 weeks. Photo-required-on-fail alone is a **S** subset (1 week) and captures most of the value.

### 5.5 Public work-order / defect request portal

**What:** Public URL anyone can hit to file a defect or request a check, without an account. Goes into a triage queue for the contractor to accept / reject.

**Why competitors have it:** Lets the contractor's customer's staff (e.g. a hospital ward nurse) report a failed RCD without a login. UpKeep markets this aggressively.

**Impact on launch if missing:** Jemena and Equinix won't notice (they have their own request systems). But the next tier of customers (hospital FM, mid-market commercial) absolutely will.

**Rough cost to add (S/M/L):** **S.** The `briefs` table (per AGENTS.md — public intake form) is the pattern. Add `defects_intake` route, anonymous insert with rate limit, surface in admin triage queue. About 1 week.

### 5.6 Time tracking on a check (clock in / clock out)

**What:** Tech taps "Start" when arriving at site, "Stop" when leaving. Duration appears on the report, optionally feeds into a labour-hour total.

**Why competitors have it:** Every billing model on the trades-platform side depends on it. Even CMMS-side (Limble, UpKeep, MaintainX) include it for cost-per-WO reporting.

**Impact on launch if missing:** Jemena specifically asked for site-arrival times in the report. SKS dispatch has no view of actual-on-site duration vs estimated.

**Rough cost to add (S/M/L):** **S.** Schema: `maintenance_check_visits` (check_id, started_at, ended_at, tech_user_id). UI: start/stop button on the check page; visit list on the report. About 1 week.

### 5.7 Customer SMS notifications

**What:** Customer gets an SMS "We're on site at 09:15" / "Visit complete, report attached".

**Why competitors have it:** All five trades platforms ship this; MaintainX and UpKeep have a version of it. Tradify built its early reputation on it.

**Impact on launch if missing:** Lower stakes for B2B-only customers; high for any mid-market expansion. Less critical than scheduling or mobile.

**Rough cost to add (S/M/L):** **S.** Twilio (or AWS SNS) integration plus an outbound queue. Email digest infrastructure already exists. About 1 week including templates.

## 6. Features eq-service has that competitors don't (the edge)

### 6.1 Three-tier job-plan model (global / customer-scoped / site-scoped)

No other tool on the list separates "this plan applies tenant-wide" from "this plan is for one specific customer's sites only". simPRO has customer-specific job templates but they aren't promotable to global; CMMS tools have asset-level templates but the multi-tenancy is flat. eq-service's tier model lets SKS service Equinix (47 global E1.xx plans) and Jemena (4 customer-scoped plans) on the same tenant without naming-collisions. This is a genuine moat for contractors with diverse customer rosters.

### 6.2 RCD per-circuit timing report with critical-load locking

The `rcd_test_circuits` model with per-circuit `x1_no_trip_0deg / x1_trip_0deg / x5_fast_0deg` etc plus the `critical_load` flag that locks the circuit behind an override toggle is *very* AS/NZS 3760-shaped. None of the trades tools have this. The CMMS tools handle it as a generic checklist (you'd have to build the report yourself). For regulated AU electrical work this is the report customers actually need.

### 6.3 ACB protection-setting matrix as structured data

The Step-1 collection form for ACB tests (long-time Ir/tr, short-time Isd/tsd, instantaneous, earth fault, earth leakage, accessories — motor charge / MX1 / XF / MN / MX2) captured as named columns means future trends become possible ("show me every ABB Tmax with Ir below 0.8In across the fleet"). Competitors handle this as a PDF upload at best.

### 6.4 Multi-file Maximo Delta import with consolidation

The two-phase importer (multi-file stage list → optional consolidate-to-one-check) at `/maintenance/import` is unusually capable. Most CMMS that *do* integrate with Maximo charge for "integration services". The free-text consolidate option is unique on this list as far as I can verify.

### 6.5 Kind-aware unified `maintenance_checks` model

Having `maintenance / acb / nsx / rcd / general` as `kind` discriminators on one table, with the Field Run-Sheet generator already kind-aware (one card layout per kind), means new test types (PAT testing, thermographic) are days of work rather than weeks. Competitors tend to fork "PM" and "inspection" and "test" as separate models with separate UIs.

### 6.6 Customer portal with scope and variations exposed

The `(portal)` route group exposing visits / scope / variations / defects to the customer's own users (under a separate auth flow) is closer to what enterprise EAMs do than what mid-market tools do. AroFlo and Tradify have portals but they're mostly about quote acceptance and invoice payment; eq-service's portal is about *what's in scope and what's been done*. Right shape for the asset-owner-as-customer relationship.

## 7. Features to deliberately NOT chase

### 7.1 Full CRM / lead-and-opportunity pipeline (ServiceTitan, AroFlo)

eq-service is bought by an operations manager (Royce's role), not a sales manager. SKS sales lives in HubSpot. Building a lead pipeline duplicates Hubspot, fragments the customer record, and pulls eng effort away from compliance differentiation. Pass.

### 7.2 In-app merchant payments (Tradify, Fergus, ServiceTitan)

Australian electrical contractors invoice through Xero / MYOB and reconcile bank feed. A Stripe-merchant relationship inside eq-service duplicates Xero's job-and-customer model. Better as a one-way export "post variation to Xero as a draft invoice line" later. Pass for go-live.

### 7.3 Parts marketplace / vendor directory (Limble, UpKeep)

These work for Limble at US scale; they don't work in AU because licensed-trade rules limit who can sell circuit-protection parts. Sub-scale and a regulatory minefield. Pass.

### 7.4 In-house phone system / call recording (ServiceTitan)

The B2B PPM/testing work model is "scheduled visit", not "inbound emergency". eq-service does not need a phone bridge. Pass.

### 7.5 Marketing / ads attribution (ServiceTitan)

Residential-trades-only problem space. eq-service customers don't run Google Ads to win the next switchboard PPM contract. Pass.

### 7.6 Multi-language UI (MaintainX)

Useful eventually; not for go-live in AU/NZ market. Defer until the second-country tenant lands.

## 8. Recommended priorities

### 8a. Short-term wins (pre-launch, days-not-weeks)

These are S-sized and close gaps that show up immediately in any competitor side-by-side. Cumulative ~3–4 weeks.

1. **QR-code asset scan + short-URL route** (~4 days) — bulk QR sticker page in admin + `/a/[id]` resolver to asset detail. No schema change. Closes Limble / UpKeep / MaintainX gap in demos.
2. **Time tracking on a check (visits table)** (~1 week) — Start / Stop on the check page; visit duration on the customer report. Direct ask from Jemena. Closes table-stakes gap 5.6.
3. **Per-item photo-required-on-fail** (~1 week) — extend `maintenance_check_items` with `requires_photo_on_fail`; force the UI to capture a photo before allowing save. Big credibility lift for compliance customers.
4. **Customer SMS via Twilio for "on the way" / "complete"** (~1 week) — uses the existing email-digest dispatch worker; adds an SMS template set. Visible value to customers.
5. **"The Wall" status board** (~3 days) — kanban dashboard widget over `maintenance_checks` by status. Borrowed from Fergus. Low cost, high "I can see everything at once" value.

### 8b. Mid-term (post-launch, weeks-not-months)

3–6 weeks each. Pick 2–3 based on which customers land.

1. **Scheduling / dispatch board** (~2 weeks) — `assigned_to_user_id` on checks; `/schedule` route with a weekly tech-by-day grid; reassign by drag-and-drop. Single biggest demo-vs-trade-platform gap.
2. **PWA + offline mutation queue on top three flows** (~3 weeks) — installable manifest, service worker, IndexedDB queue replaying through `withIdempotency()`. Closes the field-app gap.
3. **Public defect-request intake** (~1 week) — anonymous form using the `briefs` pattern; triage queue in admin. Opens up the mid-market FM segment.
4. **Conditional checklist + form builder polish** (~2 weeks) — branching `job_plan_items`, photo-required-per-item, signature-block. Matches AroFlo's tender selling point.
5. **Failure-codes vocabulary on defects** (~1 week) — controlled-vocab cause / remedy / problem; trend reports. Aligns with Maximo workflows that DC customers expect.

### 8c. Long-term (months, strategic — possibly leveraging EQ Shell)

These are bigger and want EQ Shell's cross-module data flows (per PR #151).

1. **Variation → Xero draft-invoice line export** (~6 weeks) — one-way write into Xero / MYOB so contract variations flow into accounting without duplicate entry. Uses the EQ Shell event bus to fan out the same variation to other EQ modules (EQ Expenses, EQ Quotes). Doesn't compete with Xero, complements it.
2. **Meter-based PM scheduling** (~4 weeks) — schedule PMs by run-hours / op-counter, not just by calendar. Differentiator for generator / breaker fleets. Generator op-counter fields already exist on `acb_tests`; need a `meter_readings` table and a trigger evaluation job.
3. **Calibration management for instruments** (~3 weeks) — certificate upload + expiry alerts + "this test used an instrument out of calibration" warning on reports. Heavy compliance lift; small build.
4. **Permit-to-work / lockout-tagout workflow** (~6 weeks) — formal permit issuance, isolation checklist, multi-party sign-off. Maximo-grade; opens the data-centre and utility tenders explicitly.
5. **Public API + Zapier app** (~4 weeks + Zapier review cycle) — auto-generated public REST from server actions, scoped by tenant API key. Lets customers wire eq-service to their own automation. Unlocks integration deals.

## 9. Cross-references

- **UX audit (PR #149)** — the UX audit at `docs/audits/2026-05-18-creation-flows-ux.md` covers *how* existing flows feel; this audit covers *which features are absent*. The UX audit's "create-check flow has too many clicks" recommendation pairs with §8a.1 (QR scan opens the asset/check straight away — fewer clicks) and §8a.5 (status board reduces the navigation cost of finding the next check).
- **EQ Shell integration proposal (PR #151)** — the Shell-integration plan unlocks several §8c items. Specifically: (a) variation → Xero export is a clean Shell event-bus producer; (b) permit-to-work is the kind of cross-module workflow Shell is designed for (HR roster + Operations permit + Field execution); (c) meter readings could fan out from any source module via Shell, not only entered in eq-service.
- **Sentry runbook + alert spec (recent commits)** — competitor observability stories are weak across the board (most don't expose error rates to customers, none publish SLO reports). eq-service's Sentry wiring is *internal* observability; combining it with a public "service health" page (uptime + recent incidents) would be a small differentiator on enterprise tenders. Out of scope for this audit; flagging here so it doesn't get lost.
- **Tier framework Phases A & B (memory + PR #82)** — the recommendation in §6.1 (three-tier job plans as differentiator) and the tier framework's product tiers are different axes. The job-plan tier is *configuration scope*; the product tier is *pricing-tier feature gating*. Both should coexist; this audit's recommendations should be reviewed against the Phase C hard-gates plan so we don't promise an Enterprise feature at the Starter tier.

---

*Audit compiled 2026-05-19. Pricing and feature claims marked as "needs confirmation" or "reported in reviews" should be re-verified before any external use of this document. Vendor links go to current public pricing/feature pages where possible.*
