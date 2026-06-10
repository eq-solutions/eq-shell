# EQ Solves — Architecture Reference

> Living document. Updated when structural decisions change. Cowork appends to the Decisions log when any architectural choice is made or revised.
> Last updated: Sprint 27 — 09 Apr 2026.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 16 | App Router, TypeScript strict mode |
| Styling | Tailwind CSS v4 | CSS-first config via `@theme` in `globals.css` — no `tailwind.config.ts` |
| UI Components | Custom | Button, Card, DataTable, Modal, SlidePanel, StatusBadge, Sidebar, Breadcrumb, Pagination, SearchFilter, AttachmentList, TenantLogo, ExportButton, HelpWidget |
| Typography | Plus Jakarta Sans | Google Fonts |
| Mutations | Next.js Server Actions | No separate API server for writes |
| Read API | Next.js Route Handlers | Paginated REST endpoints under `app/api/` |
| Database | Supabase (PostgreSQL) | Project ID: `urjhmkhbgaxrofurpbgc` |
| Auth | Supabase Auth | Email/password + TOTP MFA + bcrypt recovery codes |
| File Storage | Supabase Storage | `attachments` bucket (private, tenant-prefixed), `logos` bucket (public, auth-required upload) |
| Validation | Zod v4 | Schemas in `lib/validations/` — use `.error.issues[0]` not `.errors[0]` |
| Email | Resend | Custom SMTP in Supabase — replaces 2/hr default limit |
| DOCX Generation | docx (docx-js) | ACB + NSX test reports — per-site DOCX with white-label branding |
| Hosting | Netlify | Production at eq-solves-service.netlify.app, auto-deploy from main branch |

---

## Repository Structure

```
/
├── app/
│   ├── (auth)/          # Public: signin, MFA challenge, enrol-MFA, forgot/reset password, callback, signout
│   ├── (app)/           # Protected (AAL2 required):
│   │   ├── dashboard/
│   │   ├── customers/
│   │   ├── sites/
│   │   ├── assets/
│   │   ├── job-plans/
│   │   ├── maintenance/      # Maintenance checks list + create
│   │   │   └── [id]/         # Full-page check detail (asset table + tasks)
│   │   ├── testing/          # Consolidated testing (tabs: General/ACB/NSX)
│   │   │   ├── acb/          # ACB testing — E1.25 asset collection, workflow, Excel batch fill
│   │   │   └── nsx/          # NSX/MCCB testing
│   │   ├── acb-testing/     # ACB test records (legacy actions)
│   │   ├── nsx-testing/     # NSX/MCCB test records
│   │   ├── instruments/     # Instrument register (calibration tracking)
│   │   ├── search/          # Global search across all entities
│   │   ├── audit-log/       # Admin audit log viewer
│   │   ├── contract-scope/   # Per-customer FY scope management
│   │   ├── onboarding/       # First-login setup wizard
│   │   ├── reports/
│   │   └── admin/
│   │       ├── users/
│   │       ├── settings/
│   │       └── reports/      # Report template settings
│   ├── api/             # REST read routes + report endpoints
│   │   ├── acb-report/      # GET → ACB DOCX download
│   │   ├── nsx-report/      # GET → NSX DOCX download
│   │   └── pm-asset-report/ # GET → PM asset report DOCX download
├── components/
│   ├── ui/              # Shared components
│   └── modules/         # Feature-specific components
├── lib/
│   ├── supabase/        # client.ts, server.ts, admin.ts, middleware.ts
│   ├── actions/         # auth.ts (requireUser), attachments.ts (upload/delete/signedUrl), audit.ts (logAuditEvent)
│   ├── api/             # response.ts, pagination.ts, auth.ts helpers
│   ├── reports/         # acb-report.ts, nsx-report.ts, pm-asset-report.ts — DOCX generators
│   ├── types/           # index.ts — single source for all TS types
│   ├── validations/     # Zod schemas per entity (asset, customer, site, job-plan, maintenance-check, test-record, acb-test, nsx-test, instrument)
│   ├── utils/           # cn.ts, format.ts, roles.ts, csv-export.ts, csv-parser.ts, acb-excel.ts
│   └── tenant/          # getTenantSettings.ts
├── supabase/
│   ├── migrations/      # See the directory itself — it is the source of truth
│   └── seed/
└── proxy.ts             # Next.js 16 middleware
```

---

## Database Schema

### Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| `profiles` | User profiles | Role, is_active, last_login_at |
| `mfa_recovery_codes` | TOTP recovery | Bcrypt-hashed, consumed on use |
| `tenants` | Tenant record | name, slug, is_active |
| `tenant_settings` | White-label config | product_name, logo_url, 4 colour fields |
| `tenant_members` | User ↔ tenant + role | role enum: super_admin/admin/supervisor/technician/read_only/user |
| `customers` | Client companies | name, code, ABN, contact fields, is_active |
| `sites` | Physical locations | customer_id FK, address fields, is_active |
| `assets` | Equipment register | site_id FK, job_plan_id FK, dark_site_test bool, 40+ fields incl. protection settings, maximo_id (ref only), is_active |
| `job_plans` | PM templates | code, type, is_active. Frequency lives on items, not the plan |
| `job_plan_items` | Template line items | sort_order, is_required, freq_monthly/quarterly/semi_annual/annual/2yr/3yr/5yr/8yr/10yr booleans, is_dark_site — hard delete allowed |
| `maintenance_checks` | Instantiated checks | site_id, job_plan_id (optional), frequency, is_dark_site, custom_name (auto: "Site - Month - Year"), start_date, maximo_wo_number, maximo_pm_number; status: scheduled/in_progress/complete/overdue/cancelled |
| `check_assets` | Check ↔ Asset junction | check_id FK, asset_id FK, status (pending/completed/na), work_order_number, notes. RLS tenant-scoped |
| `maintenance_check_items` | Check line items | check_asset_id FK — per-asset tasks filtered by frequency flags at creation; result: pass/fail/na; completed_at/by |
| `test_records` | Electrical tests | asset_id FK, result: pending/pass/fail/defect, is_active |
| `test_record_readings` | Test measurements | label, value, unit, pass bool, sort_order |
| `attachments` | Files (polymorphic) | entity_type + entity_id; Supabase Storage path; signed URL on download |
| `acb_tests` | ACB test records | asset_id FK, site_id FK (denormalised), cb_make/model/serial, test_type, overall_result, step1/2/3_status workflow tracking. 22 asset collection fields (brand, breaker_type, name_location, performance_level, protection_unit_fitted, trip_unit_model, current_in, fixed_withdrawable, protection settings, accessories). Migration 0023 |
| `acb_test_readings` | ACB measurements | label, value (required), unit, is_pass bool, sort_order |
| `nsx_tests` | NSX/MCCB test records | tenant_id, asset_id, site_id, test_date, tested_by, test_type (Initial/Routine/Special), cb_make/model/serial/rating/poles, trip_unit, overall_result (Pending/Pass/Fail/Defect), is_active |
| `nsx_test_readings` | NSX measurements | label, value (required), unit, is_pass bool, sort_order |
| `audit_logs` | Change log | tenant_id, user_id, action, entity_type, entity_id, summary, metadata (jsonb). Immutable — no update/delete RLS policies |
| `instruments` | Instrument register | name, instrument_type, make, model, serial_number, asset_tag, calibration_date/due/cert, status (Active/Out for Cal/Retired/Lost), assigned_to, notes, is_active |
| `defects` | Defect tracking | severity (low/medium/high/critical), status workflow (open→in_progress→resolved→closed), linked to checks/assets/sites |
| `contract_scopes` | Contract scope items | customer_id, site_id, financial_year, scope_item, is_included |
| `site_contacts` | Site contact people | site_id FK, name, email, phone, role, is_primary |
| `notifications` | User notifications | user_id, type, title, message, entity_type, entity_id, is_read |

### RLS Pattern

```sql
-- Read: tenant isolation
tenant_id = ANY(get_user_tenant_ids())

-- Write: role check
get_user_role(tenant_id) IN ('admin', 'supervisor')  -- varies by table

-- Admin ops: service role client bypasses RLS entirely
```

### Helper Functions (all SECURITY DEFINER)

- `get_user_tenant_ids()` — returns tenant IDs for current user
- `get_user_role(tenant_id)` — returns role for current user in that tenant
- `is_tenant_admin(tenant_id)` — boolean
- `is_super_admin()` — boolean
- `is_admin()` — boolean (profiles.role check, legacy)

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Template → Instance (job plans → checks) | Plan changes don't affect in-progress checks |
| 2 | Polymorphic attachments table | One table serves all entity types as modules grow |
| 3 | Soft deletes via `is_active` everywhere | Full audit trail; exception: consumed MFA codes, job plan items |
| 4 | CSS custom property white-labelling | Colour changes apply at login with zero redeploy |
| 5 | Single tenant per user (current) | Multi-tenant switching deferred; first active `tenant_members` row used |
| 6 | `proxy.ts` not `middleware.ts` | Next.js 16 idiom — not a deviation |
| 7 | Password reset via service role | Supabase blocks `updateUser` at AAL1 when MFA is enrolled |
| 8 | Resend SMTP | Default Supabase SMTP limits at 2 emails/hour |
| 9 | Server actions for all mutations | Type-safe, co-located with UI; no separate API server needed |
| 10 | Zod v4 `.issues` not `.errors` | Upgraded to v4; enum `error` option replaces `errorMap` |
| 11 | Tailwind v4 CSS-first config | `create-next-app` installs latest stable; no `tailwind.config.ts` |
| 12 | Next.js 16 (not 14) | Latest stable via `create-next-app@latest` — App Router unchanged |
| 13 | IBM Maximo alignment | Job Plans are templates per asset type, frequency on items not plans, check_assets junction for per-asset tracking |
| 14 | Two-path check creation | Path A: site + frequency auto-finds assets. Path B: manual Maximo asset IDs from customer WO list |
| 15 | Full-page detail routes | Maintenance check detail is a dedicated `/maintenance/[id]` route, not a SlidePanel |
| 16 | Clickable table rows | All DataTable instances use `onRowClick` — no icon action columns |
| 17 | Consolidated testing route | `/testing` with tab nav (General/ACB/NSX) replaces separate sidebar items |
| 18 | ACB E1.25 auto-filter | ACB testing page auto-finds global E1.25/LVACB job plan — no manual site/plan selection |
| 19 | Client-side Excel batch fill | SheetJS (xlsx) for offline ACB asset collection — export → fill → import pattern |
| 20 | Report template settings | Tenant-configurable report sections, company details, sign-off fields via `tenant_settings` |

---

## Auth Flow

```
Request to /app/*
  → proxy.ts: refresh session cookies
  → No session → /auth/signin
  → AAL1 + MFA enrolled → /auth/mfa
  → AAL2 → render app

Enrolment (/auth/enroll-mfa)
  → Supabase TOTP enrol → QR as data:image/svg+xml (render as <img>)
  → Verify 6-digit code
  → Generate 8 recovery codes (XXXXX-XXXXX, bcrypt, shown once, downloadable)
  → Stored in mfa_recovery_codes

Recovery (/auth/mfa → recovery tab)
  → Match against bcrypt hashes → consume → unenrol factor → force re-enrol

Password reset
  → /auth/forgot-password → Supabase email with link to /auth/callback?next=/auth/reset-password
  → Callback exchanges code → /auth/reset-password
  → admin.auth.admin.updateUserById() (service role — bypasses AAL requirement)
  → Sign out after update
```

## White-Label Flow

```
Login → getTenantSettings(userId) → tenant_settings row
  → app/(app)/layout.tsx injects:
      style="--eq-sky:{primary}; --eq-deep:{secondary}; --eq-ice:{accent}; --eq-ink:{text}"
  → TenantLogo: renders logo_url image or product_name text fallback
  → All bg-eq-sky / text-eq-ink classes resolve to tenant colours
```

## Attachment Flow

```
Upload (supervisor+ or assigned technician on their check)
  → Select file: PDF/JPG/PNG/XLSX/DOCX/CSV/TXT, max 10MB
  → uploadAttachmentAction()
  → Storage path: {tenant_id}/{entity_type}/{entity_id}/{filename}
  → Insert row in attachments

Download
  → getAttachmentUrlAction() → signed URL (1hr expiry)

Delete (admin only)
  → deleteAttachmentAction() → remove storage object + DB row
```

---

## Conventions

- `requireUser()` at the top of every server action — resolves user, tenant, role
- `tsc --noEmit` at 0 errors before any sprint is closed
- No credentials hardcoded — `.env.local` only, never committed
- No deployment without explicit Royce instruction in chat
- Working before refactoring
- Auth changes → flag to chat before acting
