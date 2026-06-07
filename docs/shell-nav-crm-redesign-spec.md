# EQ Shell — navigation + records redesign (build-spec for Claude Design)

Status: **spec for mockups, not yet built.** Refreshed 2026-06-07.

How to use: in **Claude Design** (claude.ai/design), "start with context" against the
`eq-shell` repo and paste this as the prompt. Produce mockups for the three areas below
**before** any code. Every fact here is verified against the live SKS tenant + current
code on `main` — treat it as ground truth, not assumption.

## Brand / aesthetic (non-negotiable)
- **Plus Jakarta Sans.** Palette: `#3DA8D8` sky · `#2986B4` deep · `#EAF5FB` ice · `#1A1A2E` ink.
- **No gradients, no shadows.** Linear/Notion flatness, hairline borders, generous whitespace.
- Icons: **Lucide** only. **Plain-English** labels — never "tenant / canonical / entity / module / schema" on a user-facing surface.
- The in-app **IconRail** (48px icon-led vertical nav, shown inside Field/Service/Cards/Quotes) is the look Royce likes — the main shell nav should read as a *richer sibling* of it, same visual language.
- Components to reuse (don't reinvent): `@eq-solutions/ui` (Button/Table/Skeleton), `HubSidebar`, `HubLayout`, `IconRail`, and the detail-drawer interaction from `EntityBrowserPage`.

## Verified ground truth (2026-06-07)
- **Nav today = 7 section headers:** Records (Customers·Sites·Contacts·Staff·Licences) · Equipment (Plant & equipment) · Apps (Field·Service·Quotes·Cards) · Intake (Import) · Reports (GM Reports) · Admin (Users·Audit·Migration·Security groups·Settings) · Platform (Tenants, admin-only) — plus a loose Security/2FA link. Four groups hold a single item.
- **CRM hierarchy is real:** `app_data.sites.customer_id` and `app_data.contacts.customer_id` both exist (+ `external_customer_id`); sites also carry `site_contact_name/_email/_phone`. A Customer owns Sites and Contacts — but the UI shows three flat, unlinked lists.
- **Equipment = `app_data.assets`** (shared with Service CMMS; Plant & Equipment is `asset_type='plant_equipment'`). Cert today = a `cert_url` field on the asset row. Calibration status is computed client-side from `next_service_due`. Staff certs/licences live in a *separate* `licences` table (staff_id FK, type, number, expiry). **There is no unified certificate entity** and **no custodian/assigned-to field on assets yet.**
- **Scale (SKS, real):** ~4,808 assets, ~50 staff — design the tables/lists for hundreds–thousands of rows (virtualised or paged), not dozens.

---

## Area 1 — Declutter the main sidebar (7 groups → 4)

**Problem:** four groups hold a single item; the rail reads as a wall of headers.

**Target structure:**
- **Records** — Customers, Sites, Contacts, Staff, Licences, **and Plant & equipment** (fold the Equipment group in — it's just another record type). Icons already wired: Customers=`Building2`, Sites=`MapPin`, Contacts=`User`, Staff=`Users2`, Licences=`BadgeCheck`, Plant & equipment=`Gauge`.
- **Apps** — Field, Service, Quotes, Cards (unchanged; keep counts/alert dots/BETA badges).
- **Tools** — GM Reports + **Import** (kill the standalone Intake + Reports single-item groups).
- **Admin** — Users, Audit log, Migration, Security groups, Settings. Fold the loose **Security (2FA)** link into Settings — it's a personal setting, not a section.
- **Platform** — unchanged, admin-only conditional render.

**Mock / deliver:**
1. Full sidebar, expanded — the calm 4-group rail (Records · Apps · Tools · Admin) with Platform shown for an admin variant.
2. Active-item treatment + hover.
3. Collapsed/rail state (how it narrows toward the IconRail language).
**Acceptance:** ≤4 visible groups for a normal manager; every Record item has its Lucide icon; nothing single-item gets its own header.

---

## Area 2 — Customers as a CRM hub (Customer → Sites → Contacts)

Today: three flat lists with no drill-down — the navigation pain. Make the **Customer** the spine.

**Two-pane CRM screen:**
- **Left:** searchable Customer list (company_name, state, and counts of sites/contacts per customer). Virtualised for scale.
- **Right (on select):** customer detail with **expand/collapse sections**:
  - **Summary header** — active flag, primary phone/email, `customer_group`.
  - **Sites** (accordion) — each site expands to its on-site contact (`site_contact_*`) + type/suburb.
  - **Contacts** (accordion) — people attached to this customer.
- Keep the standalone Sites/Contacts routes for power users, but make the hub the primary way in.
- **"Unassigned" bucket** for sites/contacts with no `customer_id` (real in the data).
- Reuse the `EntityBrowserPage` detail-drawer pattern + `@eq-solutions/ui` Table.

**Mock / deliver:**
1. Customer list + selected customer with **Sites expanded** showing 2–3 nested contacts.
2. Empty state — a customer with no sites yet.
3. The Unassigned bucket.
**Acceptance:** from one screen a manager can go Customer → its Sites → a site's Contacts without changing routes.

---

## Area 3 — Plant & Equipment (table + custody + certificates)

**Current:** an 8-col table (Item, Make/model, Serial, Location, Last calibrated, Next due, Status, Certificate) — feels cramped; cert is a bare `cert_url` link; custody is by **site/location** only.

**Redesign goals:**
- **Tidy the table** — collapse Last-calibrated / Next-due / Status into one **"Calibration"** column with an inline status chip (OK / Due soon / Overdue, using amber/`#e53935` sparingly), and make Certificate an **icon affordance** (view / missing). Show comfortable desktop density + the responsive horizontal-scroll fallback. Built for ~thousands of rows.
- **Custody by person, not just site** — Royce wants each asset **assigned to a staff custodian**, and the list viewable **by person**, not only by site. *(Proposal: a new `assigned_to` staff field on the asset.)* Mock an **"Assigned to"** column with avatar + a **"Group by: Site / Person"** toggle. The custodian — not the site — owns cert/calibration responsibility.
- **Certificates** — cert + calibration live together on the **asset detail**; a person's view rolls up the calibration state of everything assigned to them (e.g. "Jane · 3 tools · 1 overdue").

**Mock / deliver:**
1. The tidied table with the merged Calibration column + cert icon.
2. The **Group-by-Person** view: one custodian, their 3 tools, one overdue.
3. Asset detail with calibration + certificate together.
**Acceptance:** equipment is browseable by custodian; the table reads cleanly at desktop density; cert location is obvious.

---

## Build sequence (after mockups sign-off)
1. **Area 1** first — lowest risk, pure nav/`HubSidebar` + `sidebarConfig` change, no data model.
2. **Area 2** — new Customers hub screen, reuses existing routes/data (no schema change).
3. **Area 3** — needs the `assigned_to` asset field + a by-person query first (data-model change → its own migration via the One Pipe), so it ships last.

## Out of scope / keep
- Don't touch auth/login screens, IconRail behaviour, or iframe app embedding.
- The `assigned_to` asset field and the Import relocation are **proposals** — mock them so Royce sees the shape; data-model/route changes get built only after sign-off.
