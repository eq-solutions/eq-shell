# EQ Solves — Product Specification

> Feature spec in testable form. Maps to UAT, user manual, and handoff documentation.
> Last updated: Sprint 27 complete — 09 Apr 2026.

---

## Product Overview

**EQ Solves** is a white-label, multi-tenant SaaS platform for managing electrical assets, preventative maintenance, and compliance testing at industrial and data centre sites.

Built by EQ Solutions (CDC Solutions Pty Ltd). First commercial customer: SKS Technologies.

---

## Platform

### Multi-Tenancy
- Complete data isolation between tenants via PostgreSQL RLS
- Tenants configure: product name, logo, brand colours (primary, secondary, accent, text)
- Branding applies at login — no redeploy required
- Tenant A cannot see any data belonging to Tenant B

### Authentication
- Email + password login (invite-only — no self-registration)
- Mandatory TOTP MFA (Google/Microsoft Authenticator)
- 8 single-use recovery codes generated at MFA enrolment (shown once, downloadable)
- Password reset via email link
- Automatic session refresh

### Roles

| Role | Capabilities |
|------|-------------|
| Super Admin | Cross-tenant platform access |
| Admin | Full tenant access — all CRUD, user management, settings, deactivation |
| Supervisor | Create/manage all operational records — checks, tests, assets |
| Technician | Execute assigned maintenance checks, update item results |
| Read Only | View all records, no writes |

---

## Modules (Built)

### Dashboard
- Live counts: customers, sites, assets, job plans (all clickable)
- Maintenance stats: Scheduled / In Progress / Overdue / Complete
- Test stats: Total / Passed / Failed / Defects
- ACB Test stats: Total / Passed / Failed / Defects
- All stats colour-coded and link to filtered list views

### Customers
- Full CRUD (admin/supervisor create; admin deactivate)
- Fields: name, code, ABN, email, phone, address
- Search by name/code/email; paginated (25/page)

### Sites
- Full CRUD with linked customer
- Fields: name, code, customer, address, city, state, postcode, country (default: Australia)
- Asset count in list — links to filtered assets view
- Filter by customer; search by name/code

### Assets
- Full CRUD with linked site
- Fields: name, asset type, make, model, serial number, Maximo ID (reference only), install date, job plan (dropdown), dark site test (boolean)
- Each asset links to one job plan (1:1 asset type → job plan template)
- Expandable protection settings section (conditional electrical fields)
- Filter by site/type; search by name/type/serial/Maximo ID
- List columns: Maximo ID, Name, Site, Location, Job Plan, Status
- File attachments (PDF, images, XLSX, DOCX, CSV, TXT — 10MB max)
- CSV import: upload → auto column mapping (fuzzy match) → 5-row preview → site name resolution → validation → bulk insert with per-row error report (max 500 rows)

### Job Plans
- Full CRUD — maintenance checklist templates aligned with IBM Maximo
- Fields: name, code (job code), type, description
- Frequency lives on individual items (not the plan) — boolean flags: monthly, quarterly, semi-annual, annual, 2yr, 3yr, 5yr, 8yr, 10yr
- Dark site flag on items — tasks only performed during black start testing
- Inline item management: add/edit/delete items with description, sort order, required flag, frequency flags, dark site flag
- List columns: Job Code, Name, Type, Tasks, Status
- Filter by site; search by name

### Maintenance Checks (Maximo-Aligned)
- **Two creation paths:**
  - **Path A (auto):** Select site + frequency → system finds all assets at that site whose job plans have items matching that frequency → generates per-asset tasks
  - **Path B (manual):** Customer provides list of Maximo asset IDs + work orders → paste IDs to create check for specific assets
- Auto-named: "Site - Month - Year" (e.g. "SY2 - April - 2026")
- **Check hierarchy:** Maintenance Check → check_assets (junction, per-asset status/WO#/notes) → maintenance_check_items (per-asset tasks)
- **Full-page detail view** at `/maintenance/[id]`:
  - Header: status badge, site, due date, assigned to, frequency
  - Full-width sortable asset table: ID, Name, Location, Work Order #, Job Plan, Done, Notes
  - Click any asset row → expands to show outstanding tasks with Order, Task, Result (Pass/Fail/NA buttons), Comments
  - Inline-editable Work Order # and Notes per asset
  - Paste WO#s from Excel (bulk apply in sort order)
  - Force-complete per asset (marks all tasks as pass)
- Fields: site, frequency (monthly through 10yr), is_dark_site, start_date, due_date, custom_name, assigned_to, maximo_wo_number, maximo_pm_number, notes
- Status lifecycle: Scheduled → In Progress → Complete / Cancelled
- Complete blocked until all required items have a result (N/A counts)
- Cancel: admin only
- Attachments: supervisor+ or assigned technician can upload
- Filter by site/status; search by check name/site name
- All table rows clickable — no icon action columns

### Test Records
- Full CRUD for general electrical tests
- Fields: asset (auto-fills site), test type, test date, tested by, result (Pending/Pass/Fail/Defect), next test due, notes
- Inline readings: add/delete (label, value, unit, pass/fail)
- Attachments: supervisor+ upload
- Filter by site/result; search by asset/site/test type

### Compliance Reports
- Filter: site + date range
- KPI cards: Maintenance Compliance %, Overdue Checks, Test Pass Rate %, Test Defects
- Colour thresholds: green ≥80%, amber ≥50%, red <50%
- Charts: maintenance status distribution, test result distribution (horizontal bar)
- Overdue by site: top 5
- Recent failures: last 10 failed/defect tests

### Admin — User Management
- Invite by email (Supabase invite flow with assigned role)
- Toggle active/inactive; change role
- Cannot self-deactivate or self-demote

### Admin — Tenant Settings
- Edit: product name, logo URL, brand colours
- Live colour preview strip
- Changes apply on next page load

---

### ACB Test Records ✅
- Full CRUD for Air Circuit Breaker tests
- Fields: asset (auto-fills site), test date, tested by, test type (Initial/Routine/Special), overall result (Pending/Pass/Fail/Defect), notes
- Circuit breaker details: CB make, CB model, CB serial number
- **22 asset collection fields** on `acb_tests`: breaker identification (brand, breaker_type, name_location, performance_level N1/H1/H2/H3/L1, protection_unit_fitted, trip_unit_model, current_in, fixed_withdrawable), protection settings (long_time_ir/delay, short_time_pickup/delay, instantaneous, earth_fault_pickup/delay, earth_leakage_pickup/delay), accessories (motor_charge, shunt_trip_mx1, shunt_close_xf, undervoltage_mn, second_shunt_trip)
- **3-step workflow** (AcbWorkflow component):
  - Step 1 (Asset Collection): breaker identification, trip unit & ratings, protection settings (conditional on protection_unit_fitted), accessories with voltage dropdowns
  - Step 2 (Visual & Functional — default tab): 23 items in 5 sections (Visual Inspection 4, Service Operations 3, Functional Tests Chassis 3 incl. numeric op counter, Functional Tests Device 11, Auxiliaries 2). OK/Not OK/N/A with comment on failure
  - Step 3 (Electrical Testing): contact resistance R/W/B µΩ with 30% variance warning, IR Closed (7 combos MΩ), IR Open (4 MΩ), temperature °C, secondary injection, maintenance completion
- **Site-level asset collection** (AcbSiteCollection): expandable cards per CB with all collection fields
- **E1.25 auto-filter**: ACB testing page auto-finds global E1.25/LVACB job plan, shows table of matching assets per site with status columns
- **Excel batch fill**: export pre-populated .xlsx per site, fill offline, import back to batch-update all CB data (SheetJS)
- Inline readings: add/delete (label, value (required), unit, pass/fail)
- Attachments: supervisor+ upload, admin delete. Entity type: `acb_test`
- Filter by site/result; search by asset name, CB make, CB model, test type
- Dashboard: ACB Test stats row (Total/Passed/Failed/Defects)
- Consolidated under Testing tab navigation (General/ACB/NSX)

### ACB Reports (DOCX) ✅
- Per-site report covering all active ACB tests — generated on demand from ACB Testing page
- Report structure matches Delta Elcom ACB test report template:
  - **Cover page:** Site name + year, generated date, tenant product name (white-label)
  - **Table of Contents:** Auto-generated from breaker headings
  - **Per-breaker sections** (one per ACB test):
    - Header table: Site, Asset, Location, ID, Job Plan
    - Circuit Breaker Details: 24-attribute grid (brand, breaker type, serial, protection settings, trip unit, poles, current rating, shunt/close/UV accessories)
    - Visual / Functional Test Results: 3 quick items + 27-row checklist with section groupings (Visual Inspection, Mechanical degreasing, Device Functional Check, Auxiliaries Check, Device Racking In, greasing, Overall)
    - Electrical Testing: Main Contact Resistance (3 phases), Insulation Resistance Closed (9 measurements), Insulation Resistance Open (4 measurements), Secondary Injection, Operation Counter After
    - Protection Test Results: Short time, Instantaneous, Long time — current levels, trip times, pass/fail
- White-label: heading colour from tenant primary colour, Plus Jakarta Sans font
- Download: API route `GET /api/acb-report?site_id=xxx` returns DOCX attachment
- Permissions: supervisor+ to generate
- Readings matched to template sections by label (case-insensitive)

### NSX / MCCB Test Records ✅
- Full CRUD for NSX/MCCB circuit breaker test records
- Schema: `nsx_tests` (asset_id, site_id, test_date, tested_by, test_type Initial/Routine/Special, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, overall_result Pending/Pass/Fail/Defect, is_active) + `nsx_test_readings` (label, value required, unit, is_pass, sort_order)
- CB detail fields include rating, poles, and trip unit (not in ACB schema — NSX-specific)
- Readings: inline add/delete, same pattern as ACB
- Attachments: entity_type `nsx_test`
- RLS: tenant-scoped read, supervisor+ create/edit, admin delete
- Dashboard: NSX Tests stats row
- Sidebar: CircuitBoard icon

### NSX Reports (DOCX) ✅
- Per-site NSX/MCCB report — same pattern as ACB reports
- Report structure:
  - Cover page: Site name, year, generated date, white-label branding
  - Table of Contents
  - Per-breaker sections: header table, CB details (16 attributes), visual/functional checklist (16 items), electrical testing (contact resistance, IR closed, IR open), trip test results (long time, short time, instantaneous, earth fault)
- Download: API route `GET /api/nsx-report?site_id=xxx`
- Permissions: supervisor+

### Audit Log ✅
- Immutable audit trail of all significant user actions
- Schema: `audit_logs` table with tenant_id, user_id, action (varchar 50), entity_type, entity_id, summary, metadata (jsonb)
- RLS: tenant-scoped read for admins only; insert for authenticated users; no update or delete policies (immutable)
- Shared `logAuditEvent()` action in `lib/actions/audit.ts` — silent failure (try/catch) so audit never blocks primary operations
- Admin-only viewer at `/audit-log` with:
  - Paginated DataTable (25/page)
  - Filters: entity type dropdown, action dropdown
  - Colour-coded action badges: create (green), update (blue), delete (red), login (purple), export (amber)
  - User name resolution from profiles
- 5 database indexes for performance (tenant_id, user_id, action, entity_type, created_at)
- Sidebar: ScrollText icon in Admin section

### Global Search ✅
- Single search input that queries across 6 entity tables in parallel
- Tables searched: assets, sites, customers, acb_tests, nsx_tests, instruments
- Pattern matching: `.or()` with `ilike` on name/title/code fields per entity
- Returns typed `SearchResult[]` with type, id, title, subtitle, href (clickable to entity)
- Type-specific icons: Package (assets), MapPin (sites), Building2 (customers), Shield (ACB), CircuitBoard (NSX), Wrench (instruments)
- Coloured type badges for visual distinction
- Sidebar: Search icon in main nav

### Instrument Register ✅
- Full CRUD for test instruments and calibration tracking
- Schema: `instruments` table with name, instrument_type, make, model, serial_number, asset_tag, calibration_date, calibration_due, calibration_cert, status (CHECK: Active/Out for Cal/Retired/Lost), assigned_to (FK profiles), notes, is_active
- RLS: tenant-scoped read, supervisor+ create/edit, admin deactivate
- List view with:
  - Filters: status dropdown, instrument type dropdown
  - Calibration due date highlighting (red if overdue)
  - Status badges mapped to StatusBadge component (Active=active, Out for Cal=not-started, Retired=inactive, Lost=blocked)
  - Assignee name resolution
- Detail panel: calibration section with last calibrated date, due date (red if overdue), certificate reference
- Form: SlidePanel with calibration section, status dropdown, assigned_to user picker
- Sidebar: Wrench icon in main nav

### User Management (Enhanced) ✅
- `requireAdmin()` updated to support both `super_admin` and `admin` roles
- Self-demotion check updated: admins and super_admins cannot demote themselves below admin
- Role hierarchy enforced consistently across invite, role change, and active toggle actions

### PM Asset Reports (DOCX) ✅
- Per-asset maintenance report generated from completed checks
- Report structure: cover page (logo, site, tenant branding), site overview, contents page with internal links, executive summary with KPI grid (pass rates, task breakdown), per-asset sections with colour-coded task checklists, defect/action callouts, confirmation statements, sign-off page
- Configurable via tenant report settings: section toggles, company details, custom header/footer, sign-off fields (JSONB)
- Download: API route `GET /api/pm-asset-report?check_id=xxx`
- Permissions: supervisor+

### Report Settings (Admin) ✅
- Tenant-level report template customisation at `/admin/reports`
- Section toggles: cover page, site overview, contents, executive summary, sign-off
- Company details: name, address, ABN, phone
- Custom header/footer text overrides
- Configurable sign-off fields (add/remove signature lines)
- Migration `0015_report_settings.sql`

### Customer Logos & Site Contacts ✅
- Customer `logo_url` displayed in site list with fallback initial avatar
- Site contacts: full CRUD per site with primary contact flag, star icon, inline form
- Migration `0016_customer_logos_and_site_contacts.sql`

### Contract Scope ✅
- Per-customer, per-FY scope management at `/contract-scope`
- Included/excluded items, grouped list view
- Integrated into check creation: scope info panel shown when selecting a site
- Migration `0017_contract_scope.sql`

### Defect Tracking ✅
- Defect table with severity (low/medium/high/critical) and status workflow (open→in_progress→resolved→closed)
- Linked to checks, assets, and sites with RLS
- Raise/update defect actions from maintenance checks
- Migration `0018_defects.sql`

### CSV Data Export ✅
- Client-side blob download on Assets, Sites, and Customers tables
- Reusable `ExportButton` component and `exportToCsv()` utility

### Mobile Responsive Sidebar ✅
- Hidden on mobile with hamburger menu
- Slide-in drawer with backdrop overlay, auto-close on route change, body scroll lock

### User Onboarding Wizard ✅
- 3-step first-login setup (company details → first site → ready) for admin users
- Modal overlay when `setup_completed_at` is null, skip option available
- Migration `0019_onboarding.sql`

### Help Widget ✅
- Floating command palette with 15+ help items
- Search, keyboard shortcut (?), route-change auto-close

### Asset Grouped View ✅
- Collapsible tree layout: Site → Location → Job Plan with all assets (unpaginated)
- Toggle between table view and grouped view

### Consolidated Testing Menu ✅
- Unified `/testing` route with tab navigation (General/ACB/NSX)
- Replaces separate sidebar items

---

## Modules (Planned / Backlog)

| Module | Priority | Description |
|--------|----------|-------------|
| Email Notifications | P1 — pre-go-live | Wire Resend to notification engine — check assigned, overdue, defect raised, completed |
| Tenant Provisioning UI | P1 — pre-go-live | super_admin UI to create/manage tenants without seed scripts |
| Compliance Report PDF Export | P1 — pre-go-live | "Download PDF" on /reports — KPI cards, charts, overdue table, white-labelled |
| Recurring Check Scheduling | P2 — post go-live | Recurrence field on checks; prompt to create next instance on completion |
| Mobile/Tablet UX Pass | P2 — post go-live | Touch-optimised /maintenance/[id] — large tap targets, no hover-dependent UI |
| Client Read-Only Portal | P2 — post go-live | read_only role scoped per customer for Equinix-style client access |
| Offline Mode | Backlog (CR-001) | Tablet offline entry with sync — +4 sprint estimate; await SKS confirmation |

---

## Business Rules

- No hard deletes — `is_active` soft delete on all entities (except consumed MFA codes and removed job plan items)
- Job plan items copied to check at creation — subsequent plan edits don't affect existing checks
- CSV import maximum: 500 rows per file; site names must match existing records
- Attachments: 10MB max; PDF/JPG/PNG/XLSX/DOCX/CSV/TXT only
- Signed download URLs expire after 1 hour
- Pagination: 25 records per page default
- WCAG 2.1 AA contrast minimum on all text

---

## Acceptance Criteria

### Auth
- [ ] Sign-in with email + password works
- [ ] No MFA → redirect to enrolment before app access
- [ ] TOTP accepted from authenticator app
- [ ] Recovery code consumed on use, forces re-enrolment
- [ ] Deactivated user signed out on next request
- [ ] Admin cannot self-deactivate or self-demote

### Assets
- [ ] List renders with site/job plan filters functional (job plan dropdown shows `name - type`)
- [ ] Create/edit validates required fields
- [ ] CSV import: column mapping, preview, site validation, per-row error report
- [ ] Attachments: upload, download (signed URL), delete (admin)
- [ ] Protection settings conditional display works

### Maintenance Checks (Maximo-Aligned)
- [ ] Path A creation: site + frequency auto-finds matching assets and generates per-asset tasks
- [ ] Path B creation: manual Maximo asset IDs accepted, check created for those specific assets
- [ ] Auto-naming: check named "Site - Month - Year"
- [ ] check_assets junction created with correct asset links
- [ ] Per-asset tasks filtered by frequency boolean flags on job plan items
- [ ] Full-page detail at `/maintenance/[id]` with sortable asset table
- [ ] Click asset row → expands to show outstanding tasks with Pass/Fail/NA
- [ ] Paste WO#s from Excel applies in current sort order
- [ ] Force-complete marks all asset tasks as pass
- [ ] Inline-editable WO# and Notes per asset
- [ ] Items not editable until check is In Progress
- [ ] Complete blocked with incomplete required items (N/A is valid)
- [ ] Supervisor and assigned technician can both upload attachments
- [ ] Admin cancel works; non-admins cannot cancel

### Test Records
- [ ] Asset selection auto-fills site
- [ ] Readings add/delete inline
- [ ] Result badge correct colour per result

### ACB Test Records
- [ ] ACB testing page auto-filters E1.25/LVACB assets (global job plan, `site_id` null)
- [ ] Table shows Asset/Type/Collection/V&F/Electrical/Progress/Action columns per site
- [ ] "Start Test" creates acb_test record and opens 3-tab workflow
- [ ] Tab 1 (Asset Collection): all 22 fields render, protection settings conditional on protection_unit_fitted
- [ ] Tab 2 (Visual & Functional — default): 23 items in 5 sections, OK/Not OK/N/A with comment on failure
- [ ] Tab 3 (Electrical Testing): contact resistance with 30% variance warning, IR Closed/Open, temperature, secondary injection
- [ ] Site-level asset collection: expandable cards per CB, saves step1_status = complete
- [ ] Excel export generates .xlsx with all collection fields pre-populated
- [ ] Excel import parses uploaded .xlsx and batch-updates all CB data
- [ ] Readings add/delete inline; value is required
- [ ] Result badge correct colour per result (Pending/Pass/Fail/Defect)
- [ ] Attachments: upload (supervisor+), download (signed URL), delete (admin)
- [ ] Dashboard ACB stats row shows correct counts

### ACB Reports
- [ ] Generate Report button visible to supervisor+ only
- [ ] Site picker populated with all active sites
- [ ] DOCX downloads with correct filename (site name + date)
- [ ] Cover page shows site name, year, tenant product name
- [ ] TOC links to each breaker section
- [ ] Per-breaker CB details table shows 24 attributes, populated from readings + CB fields
- [ ] Visual/functional checklist has 3 quick items + 27 checklist rows
- [ ] Electrical testing tables render contact resistance, IR closed, IR open
- [ ] Protection test results table with short time, instantaneous, long time rows
- [ ] White-label: heading colour matches tenant primary colour
- [ ] Empty readings render as blank cells (no errors)

### NSX Test Records
- [ ] NSX Testing page lists tests with asset, make/model, rating, site, date, result
- [ ] Create form includes CB rating, poles, trip unit fields
- [ ] Detail panel shows 6 CB fields (make, model, serial, rating, poles, trip unit)
- [ ] Readings inline add/delete, pass/fail per reading
- [ ] Attachments supported (entity_type: nsx_test)
- [ ] Dashboard shows NSX test stats
- [ ] Sidebar shows NSX Testing with CircuitBoard icon

### NSX Reports
- [ ] Generate Report button visible to supervisor+ only
- [ ] DOCX downloads with correct filename
- [ ] Cover page shows site name, year, tenant branding
- [ ] Per-breaker CB details table with 16 attributes
- [ ] Visual/functional checklist with 16 items
- [ ] Electrical testing tables render correctly
- [ ] Trip test results with 4 protection rows (long/short/instantaneous/earth fault)

### Audit Log
- [ ] Audit log page accessible to admin/super_admin only
- [ ] List renders with entity type and action filters
- [ ] Colour-coded action badges (create=green, update=blue, delete=red, login=purple, export=amber)
- [ ] Paginated at 25 per page
- [ ] User names resolved from profiles
- [ ] Audit records are immutable — no edit or delete in UI or DB
- [ ] Sidebar shows Audit Log in Admin section

### Global Search
- [ ] Search input queries assets, sites, customers, ACB tests, NSX tests, instruments
- [ ] Results show type-specific icons and coloured type badges
- [ ] Clicking a result navigates to the entity's page
- [ ] Empty search state handled gracefully
- [ ] Sidebar shows Search link

### Instrument Register
- [ ] List renders with status and type filters
- [ ] Create/edit validates required fields (name, instrument_type)
- [ ] Status options: Active, Out for Cal, Retired, Lost
- [ ] Calibration due date highlighted red when overdue
- [ ] Assignee resolved to user name from profiles
- [ ] Detail panel shows calibration section with date, due, certificate
- [ ] Admin can deactivate/reactivate instruments
- [ ] Sidebar shows Instruments link with Wrench icon

### User Management (Enhanced)
- [ ] Super admin can access user management
- [ ] Admin and super_admin roles both grant user management access
- [ ] Cannot self-demote below admin level
- [ ] Cannot self-deactivate
- [ ] Role changes take effect immediately

### White-Label
- [ ] Colour changes apply without redeploy
- [ ] Logo or product name fallback in sidebar and auth screens
- [ ] Tenant A data is invisible to Tenant B

---

## User Manual Source Material

> Accumulated per sprint. Used to author the final user manual.

### Auth & Platform (Sprints 1–3)
- Sign-in is email + password. No self-registration — admin must invite users.
- MFA is mandatory. Prompted at first login. Google Authenticator or Microsoft Authenticator required.
- Recovery codes shown once at enrolment. Each code works once only. Save them securely.
- Forgotten password: use "Forgot password" on the sign-in page. Reset link sent by email.
- Brand colours and product name: Admin → Settings. Changes take effect on next page load.

### Core Data (Sprints 4–6)
- Customers must exist before sites. Sites must exist before assets.
- Deactivating a record hides it from active lists but preserves all history and linked data.
- Job plans are reusable templates. The same plan can generate multiple checks at different times.
- Frequency on a job plan is a label — the system does not auto-create checks. Checks are created manually by a supervisor or admin.

### Audit, Search & Instruments (Sprints 15–16)
- Audit log: admin-only view of all significant platform actions. Records are permanent and cannot be edited or deleted.
- Global search: one search box covers assets, sites, customers, ACB tests, NSX tests, and instruments. Results are clickable links.
- Instrument register: track test instruments with calibration dates. Overdue calibrations flagged in red. Statuses: Active, Out for Cal, Retired, Lost.
- User management now supports super_admin role alongside admin for user administration.

### ACB Testing Rebuild (Sprint 27)
- ACB testing now uses a 3-step workflow: Asset Collection → Visual & Functional → Electrical Testing. Default tab opens on Visual & Functional.
- Assets are auto-filtered by the E1.25 (LVACB) job plan — no manual selection needed.
- Site-level asset collection lets you expand each CB card and fill in all identification, protection, and accessory fields.
- Excel batch fill: export a pre-populated spreadsheet, fill it offline, then import it back to update all CBs at once.
- Voltage dropdowns on accessories: Not installed, 24V, 48V, 110V, 120V, 240V, Other.
- Visual & Functional tab has 23 inspection items across 5 sections. Each item is OK / Not OK / N/A with a comment field on failure.
- Electrical Testing tab includes contact resistance with 30% variance warnings, insulation resistance (closed and open), temperature, secondary injection, and maintenance completion fields.

### Reports, Scope & Onboarding (Sprints 23–25)
- PM asset reports can be downloaded from completed maintenance checks as DOCX. Report sections, company details, and sign-off fields are configurable in Admin → Report Settings.
- Contract scope: Admin → Contract Scope to manage included/excluded items per customer per financial year. Shown during check creation for reference.
- Customer logos display in the sites list. Site contacts can be managed on the site detail page.
- CSV export buttons on Assets, Sites, and Customers pages for quick data download.
- First-login onboarding wizard guides new admins through company details and first site creation.
- Help widget: press ? anywhere to open a searchable command palette.

### Workflows (Sprints 7–11)
- Maintenance checks are created by supervisors or admins and assigned to a technician.
- Technicians start the check themselves when ready. Items cannot be recorded until Started.
- A check cannot be completed if any required item has no result. N/A is acceptable.
- Attachments (photos, sign-off docs, inspection reports) can be added to checks and test records.
- CSV asset import: prepare file with required columns, import via Assets → Import. Max 500 rows. Site names must exactly match existing site records.
- Attachment download links expire after 1 hour. Return to the record and click download again if the link fails.
