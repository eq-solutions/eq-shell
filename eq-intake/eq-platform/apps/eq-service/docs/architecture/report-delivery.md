# Report delivery — design and recommendation

**Date:** 2026-04-16
**Author:** Engineering review follow-up
**Status:** Recommendation — awaiting Royce's sign-off before implementation
**Context:** Per-maintenance-check reports, issued to customer. Supporting docs: `docs/roadmap/2026-04-16-next-phase-plan.md` (Section 7), `docs/reviews/2026-04-16-external-engineering-review.md` (Section 7).

---

## The three asks

1. Ability to download the report as **PDF or Word**.
2. **Shared URL** for customers to download from (larger files, or a "sexy page" they can log into and see their info).
3. **What is the most scalable and professional way to do this?**

## Short answer

**Signed-URL email delivery now. Customer portal later, reading from the same table.**

- Every per-check report is generated in both PDF and DOCX and stored in the existing `attachments` Supabase bucket.
- A new table `report_deliveries` is the single source of truth for every report ever issued — who requested it, who it went to, what format, what revision, what URL, when it expired, whether it's been downloaded.
- The customer gets a branded email with a **7-day signed URL** to the PDF (and an optional DOCX link alongside).
- Internal SKS users get a "Download PDF" + "Download DOCX" button pair in the app — no email round-trip, instant.
- Reissuing a corrected report is a first-class operation: same action, increment `revision`, new signed URL, new email.
- When the customer portal (roadmap item 7) ships in Sprint 5 or later, it is a read-only page backed by `report_deliveries` for that customer. **Zero rework.** The data model you build now is the data model the portal will display.

This is what every serious B2B compliance SaaS does — DocuSign, Xero invoices, Stripe receipts, Shopify orders, AWS compliance reports. Signed URL first, portal second, in that order, never the reverse.

---

## Why not a portal first

The "sexy page where customers log in and see their info" is a real, valuable product feature. It is roadmap item 7. But for a solo-engineer internal rollout, portal-first has four strikes against it:

1. **It doubles the auth attack surface.** A customer-facing login means a new role, new RLS policies on every customer-visible table, a password-reset flow, MFA, session management, and a separate rate-limit story. All of that is defensible work — but it is also where RLS bugs become "lose the customer" incidents. The review's Section 1 Concerns already flag this as the biggest new security surface in the roadmap.
2. **Customers don't want another login.** Every B2B customer has "portal fatigue". The signed-URL-in-email pattern works because it meets the customer where they already are. They forward the email to their compliance folder, they archive it, they search their inbox for "maintenance report". That is the workflow that wins.
3. **It pushes real delivery out by a sprint or two.** Portal-first means the customer can't see a report until the portal ships. Signed-URL-first means the customer sees their first report the day the pipeline goes live.
4. **It rewrites itself when the portal eventually ships.** If the delivery mechanism is "portal", adding email later is a second pipeline. If the delivery mechanism is "signed URL emailed + persisted in `report_deliveries`", adding the portal later is literally `select * from report_deliveries where customer_id = $1` wired to a page. The *same* data model serves both.

The portal is not being cancelled — it is being *sequenced*. Phase 1 ships the pipeline; Phase 2 adds the portal on top of it when the internal rollout is stable.

---

## Data model

One new table. No changes to existing tables beyond a single nullable FK.

```sql
-- migration 00xx_report_deliveries.sql

create table public.report_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id),
  customer_id          uuid not null references public.customers(id),
  maintenance_check_id uuid not null references public.maintenance_checks(id),
  revision             smallint not null default 1,

  -- Files (both formats generated together)
  pdf_file_path        text not null,   -- attachments/{tenant_id}/reports/{mc_id}/{revision}.pdf
  docx_file_path       text not null,
  content_hash_sha256  text not null,   -- tamper-evidence, printed on the PDF

  -- Delivery record
  delivered_to         text[] not null, -- array of recipient emails
  delivered_at         timestamptz not null default now(),
  delivered_by         uuid not null references auth.users(id),
  signed_url_expires_at timestamptz not null,

  -- Lifecycle
  download_count       integer not null default 0,
  last_downloaded_at   timestamptz,
  revoked_at           timestamptz,
  revoked_by           uuid references auth.users(id),
  revoke_reason        text,

  -- Bookkeeping
  mutation_id          text,             -- paired with audit_logs for idempotency
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (maintenance_check_id, revision)
);

create index report_deliveries_tenant_idx on public.report_deliveries (tenant_id);
create index report_deliveries_customer_idx on public.report_deliveries (customer_id);
create index report_deliveries_mc_idx on public.report_deliveries (maintenance_check_id);

alter table public.report_deliveries enable row level security;

create policy "tenant members read deliveries"
  on public.report_deliveries for select to authenticated
  using (tenant_id in (select public.get_user_tenant_ids()));

create policy "writers issue deliveries"
  on public.report_deliveries for insert to authenticated
  with check (
    tenant_id in (select public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin','admin','supervisor','technician')
  );

create policy "writers revoke deliveries"
  on public.report_deliveries for update to authenticated
  using (tenant_id in (select public.get_user_tenant_ids()))
  with check (
    tenant_id in (select public.get_user_tenant_ids())
    and public.get_user_role(tenant_id) in ('super_admin','admin','supervisor')
  );

create trigger set_updated_at_report_deliveries
  before update on public.report_deliveries
  for each row execute function public.set_updated_at();
```

Properties this gives you for free:

- **Unique on `(maintenance_check_id, revision)`** — reissuing a corrected report is explicit. Revision 1 stays on record even after revision 2 supersedes it. Full audit trail.
- **`content_hash_sha256`** — printed on page 1 of the PDF. If a customer disputes a report or if you're ever asked to prove a PDF they're holding matches your system of record, you hash their file and compare. Tamper-evident without any crypto infrastructure.
- **`signed_url_expires_at`** — at the table level, not only at the storage layer. Means you can query "how many active links are out right now" in one select.
- **`revoked_at`** — if a report is issued in error, you can revoke it. The portal later will honour revocation on read.
- **`delivered_to text[]`** — multiple recipients per send. One maintenance check might go to the customer's facility manager and their compliance officer at the same time.
- **`download_count` + `last_downloaded_at`** — you can ask the SKS admin UI "did the customer actually read the report". That is an operationally valuable question.

---

## The pipeline, end to end

```
1. SKS tech completes a maintenance check.
2. Tech or supervisor clicks "Issue report" → opens a dialog:
     [ customer emails (pre-filled from customers.contact_email)
       cc: (optional)
       message: (optional free text, appears in email body)
       revision reason: (required if revision > 1) ]
3. Server action issueMaintenanceReportAction(maintenance_check_id, recipients, cc, message, reason)
     a. requireUser() → role check (technician+)
     b. withIdempotency(mutationId) wraps everything below
     c. Load maintenance check + assets + test records + customer + site
     d. Render DOCX template (existing `lib/reports/*.ts` path, reused)
     e. Convert DOCX → PDF via headless Chromium (see "PDF toolchain" below)
     f. Compute SHA-256 of the PDF
     g. Upload both files to:
          attachments/{tenant_id}/reports/{maintenance_check_id}/{revision}.pdf
          attachments/{tenant_id}/reports/{maintenance_check_id}/{revision}.docx
     h. Create a 7-day signed URL for the PDF (Supabase storage)
     i. Insert a report_deliveries row
     j. Send email via Resend (or Supabase SMTP) with PDF link + optional DOCX link
     k. Insert audit_logs row (mutation_id tied to report_deliveries.mutation_id)
     l. revalidatePath('/reports') and the relevant customer/site pages
4. Customer receives email → clicks link → Supabase signed URL → downloads PDF directly from storage.
5. Download is tracked by a Supabase Edge Function hooked to the storage download event (optional v2, can defer — the first cut can rely on customer email clicks logged by the email provider).
6. Internal SKS users click "Download PDF" / "Download DOCX" on the report page → a server action returns a fresh signed URL valid for 5 minutes → browser downloads.
```

The whole pipeline sits behind one server action. No background queue is needed for a per-check report — on paid Supabase the function limit is well above the ~10–30 seconds a per-check PDF takes. If batch reports return later, they get the `report_jobs` queue from Section 4 of the engineering review.

---

## PDF toolchain — the actual recommendation

Two live options, one clear winner for this shape of work.

### Option A — Headless Chromium (Playwright or `@sparticuz/chromium`)

**How:** Render the DOCX template to HTML (or go DOCX → HTML directly), hand the HTML to Chromium, print to PDF.

**Pros:** Pixel-accurate layout, CSS print stylesheets are battle-tested, fonts embed cleanly, customer logos and SKS branding render identically to what designers expect. Emoji, Unicode, right-to-left — all work. Most professional B2B compliance PDFs are built this way.

**Cons:** Chromium is a 150–250MB cold-start dependency. On Netlify Functions it is tight; `@sparticuz/chromium` + `puppeteer-core` (~50MB compressed) is the standard workaround. Cold start adds ~2–5s to the first request after idle.

**Mitigation on paid Supabase:** Move PDF rendering into a **Supabase Edge Function** (Deno runtime) rather than a Netlify Function. Deno has first-class PDF tooling via `https://deno.land/x/puppeteer` or via WebAssembly PDF libraries. The function runs inside Supabase, co-located with storage, meaning upload is a same-VPC write rather than an internet round-trip. This is the right answer for the paid tier.

### Option B — `pdf-lib` or `pdfkit` (no browser)

**How:** Programmatically draw the PDF page by page — text, lines, tables, images.

**Pros:** Tiny dependency (~500KB), fast, no cold start, deterministic output.

**Cons:** You write a layout engine. Every tweak to a compliance template is code, not CSS. Tables are painful. Page breaks are painful. Customer logos are painful. This is the right choice for simple certificates (single page, fixed layout, minimal variability) — it is the wrong choice for a multi-page maintenance report with 20+ assets, photos, and a customer cover page.

### Recommendation

**Headless Chromium via a Supabase Edge Function.** Specifically:

1. Keep the existing `docx@9.6.1` templates in `lib/reports/*.ts` as the source of truth for content.
2. Add a `lib/reports/html-renderer.ts` that takes the same data shape and emits HTML with a print stylesheet. This is a one-time 1–2 day job.
3. Add a Supabase Edge Function `generate-report-pdf` that receives the HTML payload, renders via headless Chromium, returns the PDF bytes.
4. The `issueMaintenanceReportAction` server action calls the edge function, takes the PDF, writes it to the `attachments` bucket.
5. DOCX is generated in-process via the existing `docx` library — no edge function needed.

Why this beats both extremes:
- **Layout fidelity** stays at what customers expect.
- **Cold start** is amortised inside Supabase, not eating Netlify function budget.
- **Solo-engineer maintenance burden** is low: when a template needs a tweak, you edit CSS, not a drawing API.
- **Paid tier unlock** — this is the specific thing paying for Supabase buys you that you cannot do cleanly on free.

Fallback: if the edge function path hits an unexpected snag, `@sparticuz/chromium` on a Netlify Background Function is the known-good plan B. Known-good plan C is Playwright on a scheduled Netlify function. Both are one day of pivot cost, not a week.

---

## Email delivery

**Recommendation:** **Resend** (resend.com). $20/month includes 50k emails, has a clean TypeScript SDK, React-based email templates (`react-email`), and delivery webhooks that fire on `email.delivered`, `email.opened`, `email.clicked`. Add the webhook handler as a Next.js route that updates `report_deliveries.download_count` / `last_downloaded_at`.

Alternatives: Postmark (slightly more expensive, stronger deliverability SLA), Supabase built-in SMTP (cheapest but no webhooks for open/click), SES (cheapest at volume but a deliverability DIY project). For a solo engineer shipping to customers who will read the emails on Outlook 365, **Resend is the right default.** Migrate to SES or Postmark later if volume or deliverability demands it.

Email template lives in `lib/email/templates/report-delivery.tsx` as a `react-email` component:

```
Subject: [SKS Technologies] Maintenance Report — {site.name} — {check.date}

SKS Technologies logo (header)

Hello {customer.contact_name},

Please find attached the maintenance report for {site.name}, completed on
{check.date} by {technician.name}.

[ Download PDF report ]       ← primary button, signed URL, 7 days
Download Word version          ← secondary link, signed URL, 7 days

Summary:
  - {asset_count} assets tested
  - {pass_count} passed / {defect_count} defects raised
  - {compliance_status}

This link expires on {expires_at}. To request a reissue, reply to this email
or contact your SKS account manager.

Report reference: {maintenance_check_id} · Revision {revision}
Content hash: {sha256_first_12}... (verify on page 1 of the PDF)

SKS Technologies Pty Ltd · electrical@sks.com.au
```

---

## The "sexy page" — how we get there without building it now

The customer portal is deferred until Sprint 5 at earliest (internal rollout first), but the *data* for it is being captured from day one. When it ships, the portal is:

- One route, `/portal` (separate root layout from the SKS app).
- One auth mechanism — magic-link email (no password), tied to `customers.contact_email`. Simpler than full auth, no portal fatigue.
- One page — "Your reports" — that queries `report_deliveries` filtered to the customer's ID.
- Optionally, "Your sites", "Your defects", "Your compliance status" — read-only, each a single query.

Because the data spine is already correct, building the portal in Sprint 5 is a 3–5 day job, not a sprint. The expensive parts (delivery pipeline, idempotency, revision model, RLS, audit trail, tamper evidence) are already paid for by the Phase 1 work.

This is the **scalable and professional** answer to the third question: *build the spine once, display it as many ways as the business needs over time*. Email delivery today, portal tomorrow, API access for enterprise customers the day after that — all reading from the same `report_deliveries` table.

---

## What gets built in what order

**Sprint 2 addition (this is where report_jobs was in the revised plan — replace with this):**

1. Migration `00xx_report_deliveries.sql` — the table above.
2. `lib/reports/html-renderer.ts` — DOCX template data → print-stylesheet HTML.
3. Supabase Edge Function `generate-report-pdf` — HTML → PDF via headless Chromium.
4. Server action `issueMaintenanceReportAction` — the orchestration above, wrapped in `withIdempotency()`.
5. Resend account + webhook handler at `/api/webhooks/resend` → updates `report_deliveries.download_count` and `last_downloaded_at`.
6. UI: "Issue report" button on the maintenance check page opens a dialog; "Reports" tab on the customer page shows all deliveries with revision, status, download count.

**Sprint 3 addition:**

7. "Download PDF" / "Download DOCX" buttons in the internal app (5-minute signed URLs, no email).
8. Revocation flow (supervisor+ can revoke a delivery, writes `revoked_at` + reason).
9. Content-hash verification page — internal tool at `/admin/reports/verify` that takes an uploaded PDF and tells you whether it matches a `report_deliveries` row.

**Sprint 5 (customer portal):**

10. `/portal` route + magic-link auth against `customers.contact_email`.
11. "Your reports" page reading from `report_deliveries`.
12. (Optional) "Your sites" / "Your defects" read-only views.

**Total solo-engineer budget:** roughly 4 days for Sprint 2 additions, 2 days for Sprint 3 additions, 3–5 days for the Sprint 5 portal when it lands. Under two weeks of engineering for a compliance-grade report delivery system that will scale from SKS's first customer to the hundredth without rework.

---

## Risks and caveats

1. **Supabase Edge Function headless Chromium is not yet a rock-solid path.** Deno's puppeteer bindings lag Node's. Budget a half-day spike to confirm before committing. Fallback is `@sparticuz/chromium` on a Netlify Background Function — known-good, slightly slower cold start.
2. **Resend webhook can be flaky in the first few weeks.** Do not rely on it for billing or compliance state. Treat `download_count` as informational, not authoritative.
3. **Signed URLs leak if the customer forwards the email.** This is a feature, not a bug — compliance reports get forwarded between facility manager, tenant rep, and auditor. If you ever need the opposite, that's when you bring the portal forward.
4. **Email deliverability to corporate Outlook 365 requires SPF, DKIM and DMARC on the sending domain.** Resend handles the DNS setup, but budget an hour to configure the records on the SKS domain. If the email address is on a domain you don't own, you can't ship this step — flag to Royce before starting.
5. **DOCX → HTML is lossy.** Complex tables or inline drawings may render differently between the DOCX and the PDF. The mitigation is that PDF is the canonical customer-facing artefact and the DOCX is a secondary convenience. If they diverge, document the PDF as authoritative.
6. **Content hash is advisory, not cryptographic provenance.** If you ever need legally-defensible tamper evidence, that's a full digital-signature pipeline (DocuSign, Adobe Sign, or a Timestamp Authority). Not needed for SKS internal rollout.

---

## What I need from Royce to proceed

1. **Email domain sign-off.** Confirm the sending address (e.g. `reports@sks.com.au` or `noreply@eq-solves.com.au`) and that you can add DNS records. DNS is the only non-code dependency.
2. **Resend account.** $20/month line item on the EQ Solutions / CDC Solutions card. Confirm which entity pays.
3. **Signed-URL expiry window.** Default is 7 days. If the customer workflow expects longer archival, say 30 days, say so now — it is a one-line change today, a migration later.
4. **Revision reason required?** If a revised report is issued, should the reason be captured (free-text) or just incremented silently? Recommendation: required. Audit trail is free insurance.
5. **Can we skip the portal until Sprint 5?** Yes/no. If no, the Phase 2 portal work moves into Sprint 3 and Sprints 2/3 additions compress.

---

**End of design.** Ready to start on Royce's green light. No code has been written yet.
