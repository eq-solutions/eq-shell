# EQ Shell — navigation + records redesign (build-spec for Claude Design)

Status: spec for mockups, not yet built. 2026-06-07.

Hand this to **Claude Design** (claude.ai/design) — "start with context" against the
eq-shell repo, or paste this as the prompt. Goal: mock the three areas below before we
build. Everything here is verified against the live SKS tenant + current code.

## Brand / aesthetic (non-negotiable)
- Plus Jakarta Sans. Palette: `#3DA8D8` sky / `#2986B4` deep / `#EAF5FB` ice / `#1A1A2E` ink.
- **No gradients, no shadows.** Linear/Notion flatness. Generous whitespace.
- Icons: **Lucide** only. Plain-English labels — no "tenant / canonical / entity / module".
- The in-app **IconRail** (48px, icon-led vertical nav used inside Field/Service/Cards/
  Quotes) is the look Royce likes — the main shell nav should feel like a richer sibling
  of it, not a different language.

---

## Area 1 — Declutter the main sidebar (8 groups → ~4)

**Current groups:** RECORDS (Customers, Sites, Contacts, Staff, Licences) · EQUIPMENT
(Plant & equipment) · APPS (Field, Service, Quotes, Cards) · INTAKE (Import) · REPORTS
(GM Reports) · ADMIN (Users, Audit log, Migration, Security groups, Settings) · PLATFORM
(Tenants, admin-only) · SECURITY (2FA).

**Problem:** four of the groups hold a single item; the rail reads as a wall of headers.

**Target structure:**
- **RECORDS** — Customers, Sites, Contacts, Staff, Licences, **and Plant & equipment**
  (fold the EQUIPMENT group in; it's just another record type). Every item gets a Lucide
  icon (Customers=Building2, Sites=MapPin, Contacts=User, Staff=Users2, Licences=BadgeCheck,
  Plant & equipment=Gauge — these are already wired in code).
- **APPS** — Field, Service, Quotes, Cards (unchanged).
- **REPORTS** — GM Reports, and move **Import** here (or under Records as an action). Kill
  the standalone INTAKE group.
- **ADMIN** — Users, Audit log, Migration, Security groups, Settings. Fold the single
  **SECURITY (2FA)** item into Settings — it's a personal setting, not a section.
- **PLATFORM** — keep, but only renders for platform admins (conditional, already is).

Net: a calmer rail of Records / Apps / Reports / Admin (+ Platform for admins). Show the
collapsed/expanded states and the active-item treatment.

---

## Area 2 — Customers as a CRM hub (Customer → Sites → Contacts)

**Verified data model (live SKS tenant):** `app_data.sites.customer_id` and
`app_data.contacts.customer_id` both exist (plus `external_customer_id`). Sites also carry
`site_contact_name / _email / _phone`. So the hierarchy is real: **a Customer owns Sites
and Contacts.** Today they're three separate flat lists with no drill-down — that's the
navigation pain.

**Design the Customers screen as a two-pane CRM:**
- Left: searchable list of Customers (company_name, state, counts of sites/contacts).
- Right (on select): the customer's detail with **expand/collapse sections**:
  - **Sites** — nested list; each site expands to show its on-site contact + type/suburb.
  - **Contacts** — people attached to this customer.
  - Summary header (active flag, primary phone/email, customer_group).
- Keep the standalone Sites / Contacts list routes for power users, but make the Customer
  hub the primary way in. Sites/contacts with no `customer_id` need an "Unassigned" bucket.
- Reuse the existing detail-drawer interaction pattern from `EntityBrowserPage`.

Mock: customer list + selected-customer detail with Sites expanded showing 2–3 nested
contacts. Empty state for a customer with no sites yet.

---

## Area 3 — Plant & Equipment (table + custody + certificates)

**Current:** `src/modules/equipment` — an 8-col table (Item, Make/model, Serial, Location,
Last calibrated, Next due, Status, Certificate). Certificate = a `cert_url` link field on
the asset. Calibration status is computed client-side from `next_service_due`.

**Verified — where certificates live:** equipment certs = `cert_url` on the asset row;
staff certs/licences = the separate `licences` table (staff_id FK, type, number, expiry).
No unified certificate entity.

**Redesign goals:**
- **Tidy the table** — it feels cramped at 8 columns. Consider grouping
  Last-calibrated/Next-due/Status into one "Calibration" column with an inline status chip,
  and making Certificate an icon affordance. Show a comfortable desktop density + the
  responsive (horizontal-scroll) fallback.
- **Custody by person, not just site** — Royce wants equipment **assigned to a staff
  member** (a custodian) and the list viewable *by staff*, not only by site. This needs a
  new `assigned_to` (staff) field on the asset. Mock: a "Assigned to" column + avatar, and
  a "Group by: Site / Person" toggle. The custodian, not the site, owns the cert
  responsibility.
- Certificate + calibration live together on the asset detail; a person's view rolls up
  the calibration state of everything assigned to them.

Mock: the table with an Assigned-to column and the Group-by-Person view (one custodian,
their 3 tools, one overdue).

---

## Out of scope / keep
- Don't touch the auth/login screens, the IconRail behaviour, or the iframe app embedding.
- The `assigned_to` asset field and the Import-relocation are **proposals** — mock them so
  Royce can see the shape; the data-model/route changes get built only after sign-off.
