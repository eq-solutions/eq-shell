# D4.1 — Records-into-Shell IA Audit

**Date:** 2026-05-31
**Scope:** Read-only audit. No code changes.
**Repos read:** `eq-shell`, `eq-solves-service`, `eq-solves-field`

---

## 1. What Shell already owns in its sidebar

Source: `src/components/HubSidebar.tsx` + `src/pages/TenantHome.tsx`

### RECORDS section

Rendered when the `records` prop is populated (done in `TenantHome` and via `HubLayout`).
Each entry links to `/:tenantSlug/data/:entity` which hits `EntityBrowserPage`.

| Key | Label | Route |
|---|---|---|
| `customer` | Customers | `/:slug/data/customer` |
| `site` | Sites | `/:slug/data/site` |
| `contact` | Contacts | `/:slug/data/contact` |

Only these three are passed as `sidebarRecords` in `TenantHome.tsx` (line 191–195). `EntityBrowserPage` (`ENTITY_VIEW`) supports a wider set of entities reachable by direct URL but none are surfaced in the sidebar.

### EQUIPMENT section

Rendered when `useCan('equipment.view')` returns true.

| Label | Route |
|---|---|
| Plant & equipment | `/:slug/equipment` |

### APPS section

Filtered by `moduleEnabled` per tenant. Possible entries:

| Key | Label | Route |
|---|---|---|
| `field` | EQ Field | `/:slug/field` |
| `service` | EQ Service | `/:slug/service` |
| `quotes` | EQ Quotes | `/:slug/quotes` |
| `cards` | EQ Cards | `/:slug/cards` |

### Other sections

- **INTAKE** (managers only): Import — `/:slug/intake`
- **REPORTS** (managers only): GM Reports — `/:slug/reports`
- **ADMIN** (managers only): Users, Audit log, Settings
- **Security** (all users): `/:slug/settings/2fa`

### Additional entities in `EntityBrowserPage` (not in sidebar)

`ENTITY_VIEW` in `EntityBrowserPage.tsx` defines 12 entity types total. The nine not in the sidebar:

| Entity key | Table | Notes |
|---|---|---|
| `staff` | `staff` | Managed in EQ Field |
| `schedule` | `schedule_entries` | Field-owned |
| `timesheet` | `timesheets` | Field-owned |
| `leave_request` | `leave_requests` | Field-owned |
| `tender` | `tenders` | Legacy |
| `prestart` | `prestart_checks` | Field-owned |
| `toolbox_talk` | `toolbox_talks` | Field-owned |
| `licence` | `licences` | Field-owned |
| `asset` | `assets` | Shown on dashboard KPI strip, linked via `/:slug/data/asset`; also exists as Equipment module (`/:slug/equipment`) |

---

## 2. What each iframe app renders as its own nav when embedded

### EQ Field (`eq-solves-field`)

EQ Field is a vanilla JS single-page application (`index.html`). It renders a full `<nav class="sidebar">` with approximately 20+ entries:

| Nav item | ID |
|---|---|
| Dashboard | `nav-dashboard` |
| My Schedule | `nav-schedule` |
| Calendar | `nav-calendar` |
| Contacts | `nav-contacts` |
| Supervision | `nav-managers` |
| Sites | `nav-sites` |
| Weekly Roster | `nav-roster` |
| Leave | `nav-leave` |
| Timesheets | `nav-timesheets` |
| Safety (flag-gated) | `nav-safety` |
| Safety Report (manager) | `nav-safety-dashboard` |
| Teams (flag-gated) | `nav-teams` |
| Edit Roster (manager) | `nav-editor` |
| PIN Management (manager) | `nav-pins` |
| Add Person | `nav-addperson` |
| Import / Export | `nav-data` |
| Help | `nav-help` |
| Projects (flag-gated) | `nav-projects` |
| Forecast (flag-gated) | `nav-forecast` |
| Job Numbers (beta) | `nav-jobnumbers` |
| Apprentices (beta) | `nav-apprentices` |
| Pipeline (SKS-only, hidden by default) | `nav-sks-pipeline` |
| Resources (SKS-only, hidden by default) | `nav-sks-pipeline-resource` |

Field also renders a **topbar** and a **mobile nav** drawer.

**Shell-mode history:** Field previously suppressed its sidebar when embedded (v3.5.22, `shell-mode` CSS). That suppression was **removed in v3.5.40**. As of the current codebase, Field shows its own full sidebar unconditionally — including when embedded inside the Shell iframe. The `eq_shell_mode` sessionStorage flag and `shell-mode` HTML class are still set by `auth.js` on successful token exchange, but no CSS rules use them to hide anything.

### EQ Service (`eq-solves-service`)

EQ Service is a Next.js app. It renders a full `<Sidebar>` component (`components/ui/Sidebar.tsx`) with the following structure:

**Top group (unlabelled):**
| Label | Route | Notes |
|---|---|---|
| Do | `/do` | Hidden for `read_only` role |
| Dashboard | `/dashboard` | Always shown |
| Records | `/records` | Hub linking to Customers, Sites, Contacts, Assets, Maintenance Plans — hidden for `technician` role |

**Operations section:**
| Label | Route | Notes |
|---|---|---|
| Maintenance | `/maintenance` | Always shown |
| Calendar | `/calendar` | Flag-gated (`calendar_enabled`) |
| Defects | `/defects` | Flag-gated (`defects_enabled`) |

**Bottom group (unlabelled):**
| Label | Route | Notes |
|---|---|---|
| Insight | `/insights` | Hidden for `technician` role |
| Search | `/search` | Always shown |
| Settings | `/settings` | Always shown |

**Admin section** (when `isAdmin=true`):
| Label | Route |
|---|---|
| Admin | `/admin` |

**Footer:**
- Shell iframe mode: "Open in new tab" link + "Via EQ Shell" chip
- Standalone mode: Sign out button

**Shell detection in Service:** The layout reads the `eq_shell_bridge` cookie (set by `/api/shell-auth` after HMAC exchange). When `isShellIframe === true`, the `<Sidebar>` is **completely removed from the DOM** (`{!isShellIframe && <Sidebar ... />}`). Footer and HelpWidget are also suppressed. The sidebar is NOT shown at all when Service detects it is embedded.

---

## 3. Where the double-menu currently occurs

| Route | Shell sidebar | Iframe app nav | Double menu? |
|---|---|---|---|
| `/:slug` (dashboard) | Yes | No | No |
| `/:slug/data/:entity` | Yes | No | No |
| `/:slug/equipment` | Yes | No | No |
| `/:slug/field` | **Yes** | **Yes — Field full sidebar + topbar** | **YES** |
| `/:slug/service` | **Yes** | **No — suppressed when `eq_shell_bridge=1`** | No (suppressed) |
| `/:slug/cards` | **Yes** | No (Flutter, no sidebar) | No |
| `/:slug/quotes` | **Yes** | Unknown (Flask — not read) | Unknown |
| `/:slug/intake` | Yes | No | No |
| `/:slug/reports` | Yes | No | No |

**Summary:** The double-menu problem currently exists only on the `/field` route. EQ Service has already solved it server-side via the `eq_shell_bridge` cookie mechanism. EQ Field previously had a suppression mechanism that was removed.

---

## 4. Record types duplicated (Shell sidebar AND iframe sidebar)

### Shell + EQ Field (double-menu in effect)

| Record type | Shell sidebar | Field sidebar |
|---|---|---|
| Sites | `/:slug/data/site` | Field `/sites` (nav-sites) |
| Contacts | `/:slug/data/contact` | Field `/contacts` (nav-contacts) |

Customers: In Shell sidebar but NOT in Field sidebar (Field has no customer concept — it is staff/site/roster focused).

### Shell + EQ Service (no double-menu — Service suppresses its sidebar)

| Record type | Shell sidebar | Service sidebar |
|---|---|---|
| Customers | `/:slug/data/customer` | Service `/customers` (via `/records` hub) |
| Sites | `/:slug/data/site` | Service `/sites` (via `/records` hub) |
| Contacts | `/:slug/data/contact` | Service `/contacts` (via `/records` hub) |

These are logically duplicated (same canonical entity, different app views) but the UI collision is prevented by Service's sidebar suppression. The underlying data is the same canonical Supabase table (`app_data.customers`, `app_data.sites`, `app_data.contacts`) accessed through different query paths.

---

## 5. Record types only in the iframe app's nav (not yet in Shell sidebar)

### In EQ Field only

| Record/feature | Field nav entry | Shell equivalent |
|---|---|---|
| Staff (people roster) | Dashboard, My Schedule, Roster, Edit Roster, Add Person | None (staff is in `EntityBrowserPage` at `/data/staff` but not linked in sidebar) |
| Timesheets | Timesheets | None |
| Leave requests | Leave | None |
| Supervision | Supervision (managers) | None |
| Safety / Safety Report | Safety, Safety Dashboard | None |
| Teams | Teams | None |
| Import / Export | Import / Export | Shell has `/intake` (different surface) |
| Projects | Projects (flag-gated) | None |
| Forecast | Forecast (flag-gated) | None |
| Job Numbers | Job Numbers (beta) | None |
| Apprentices | Apprentices (beta) | None |
| Calendar | Calendar | None |

### In EQ Service only (would be relevant if Shell were to absorb nav)

| Record/feature | Service nav | Shell equivalent |
|---|---|---|
| Assets / Equipment | `/assets` via Records hub | Shell has `/:slug/equipment` + `/:slug/data/asset` (separate surfaces) |
| Maintenance Plans / Job Plans | `/job-plans` via Records hub | None |
| Maintenance | `/maintenance` | None |
| Defects | `/defects` | None |
| Calendar | `/calendar` | None |
| Insights (reports, analytics, contract scope, variations, commercials) | `/insights` | Shell has `/:slug/reports` (GM Reports only — different) |
| Search | `/search` | None |
| Do (action hub) | `/do` | None |
| Admin | `/admin` | Shell has own admin routes |

---

## 6. Current Shell↔iframe contract: how does an iframe know it's embedded?

### EQ Service

**Mechanism:** HTTP cookie `eq_shell_bridge=1`.

**Flow:**
1. Shell's `ServiceIframe.tsx` calls `/.netlify/functions/mint-service-iframe-token` (token mode) or sets iframe src directly (cookie mode).
2. Service's `/shell` page receives the HMAC token, POSTs to `/api/shell-auth`.
3. `/api/shell-auth` validates the token, calls Supabase `generateLink()`, sets `eq_shell_bridge=1` cookie (`HttpOnly=false, SameSite=None, Secure, Max-Age=86400`).
4. Service's `(app)/layout.tsx` reads `eq_shell_bridge` via `cookies()` on every server render and suppresses the sidebar, footer, and HelpWidget when it is `'1'`.
5. `ShellReadySignal` component fires `window.parent.postMessage({ type: 'EQ_SERVICE_READY', v: 1 }, 'https://core.eq.solutions')` on mount, regardless of shell detection, as long as `window.parent !== window`.
6. Shell listens for `EQ_SERVICE_READY` to reveal the iframe.

**Token refresh:** Service can send `REQUEST_SHELL_TOKEN` postMessage; Shell responds with `SHELL_TOKEN_RESPONSE`.

**Shell URL params:** In cookie mode: no params. In token mode: `/shell#sh=<token>`.

### EQ Field

**Mechanism:** Hybrid — URL param + sessionStorage flag + HTML class.

**Cookie/token mode:**
- **Cookie mode** (`tenantUsesCookieAuth`): Shell embeds Field at `/?tenant=<slug>&shell=1`. The `?shell=1` param signals to Field that it is embedded. Field attempts cookie auth (no `#sh=`).
- **Token mode** (SKS and fallback): Shell embeds Field at `/?tenant=<slug>#sh=<token>`. Field's `auth.js` `_consumeShellToken()` reads the hash, verifies the HMAC token, then sets `sessionStorage.setItem('eq_shell_mode', '1')` and `document.documentElement.classList.add('shell-mode')`.

**Shell detection behaviour:** The `shell-mode` class is set, but as of v3.5.40 no CSS rules suppress the sidebar using it. Field's own sidebar, topbar, and mobile nav all remain visible.

**postMessage from Field to Shell:**
- Field sends `{ source: 'eq-field-shell-handoff', version: 1, kind: 'boot'|'accepted'|'rejected'|'http-error'|... }` messages.
- Shell listens via `FieldIframe.tsx` `onMessage` handler and tracks handoff state.
- Shell can receive `REQUEST_SHELL_TOKEN` from Field for token refresh; responds with `SHELL_TOKEN_RESPONSE`.

**Shell URL params used by Field:**
- `?tenant=<slug>` — which tenant workspace to load
- `?shell=1` — signals embedded mode (cookie auth path)
- `#sh=<token>` — HMAC token (token auth path)

### EQ Cards

**Mechanism:** URL param + postMessage.

**Flow:** Shell embeds Cards at `https://cards.eq.solutions/auth/handoff?shell=1`. Flutter detects `?shell=1`, sends `REQUEST_SHELL_TOKEN` postMessage. Shell's `CardsIframe.tsx` calls `mint-cards-iframe-token` and responds with `SHELL_TOKEN_RESPONSE { token }`. No sidebar suppression mechanism exists (Flutter app has no sidebar equivalent).

### EQ Quotes

**Mechanism:** Cookie (same eTLD+1) + URL param.

**Flow:** Shell embeds Quotes at `https://quotes.eq.solutions/?shell=1`. The `eq_shell_session` cookie is Domain=`.eq.solutions`, so Flask receives it automatically. Flask verifies via HMAC before_app_request hook. No sidebar suppression documented in the Shell code (Flask app internals not read in this audit).

---

## 7. Open questions and risks for the migration spec

### Double-menu (Field)

**Risk — HIGH.** Field's sidebar suppression was removed in v3.5.40. The `shell-mode` HTML class is still set by `auth.js` but nothing consumes it in CSS. Re-adding CSS suppression in Field is the minimal fix, but it requires a Field deploy. The alternative — Shell injecting a postMessage to tell Field to hide its nav — requires a Field-side listener.

**Open question:** Was the suppression removed deliberately (Royce decided Field should always show its own nav) or was it removed as a temporary measure? The changelog note at line 373 says "Removed shell-mode nav suppression... Field now shows its own sidebar/topbar/mobile-nav whether loaded standalone or inside the EQ Shell iframe." This reads as an intentional decision. Needs confirmation before D4.2 spec.

### Data duplication between Shell and Service /records

Shell's `EntityBrowserPage` and Service's `/customers`, `/sites`, `/contacts`, `/assets` routes both display canonical entity data but through different query paths and with different columns/actions. When Shell absorbs the nav, it needs to decide: does `/service/customers` keep living inside the iframe (users navigate Service's internal customer detail), or do customer/site/contact detail views move to Shell?

### Assets / Equipment surface conflict

Shell has two surfaces for assets:
- `/:slug/equipment` (EquipmentModule) — calibration register with service-due focus
- `/:slug/data/asset` (EntityBrowserPage) — generic table view

Service also has `/assets` — electrical assets under maintenance with maintenance-plan linkage.

These are the same `app_data.assets` table but with different column emphasis and different actions. The D4.2 spec must resolve whether to consolidate or keep separate surfaces with explicit labelling.

### Shell sidebar records section is hardcoded to 3 items

`TenantHome.tsx` hardcodes `sidebarRecords` to customer/site/contact only. `HubLayout.tsx` does not pass any records prop (its `HubSidebar` call omits `records`). This means the RECORDS section disappears from the sidebar on all non-home pages (Field, Service, Equipment, EntityBrowser pages). Navigation to records is broken on deep routes.

### No shell-embedding detection for EQ Quotes

The Flask app receives `?shell=1` in the URL but the Shell codebase has no record of what Quotes does with it (sidebar suppression, postMessage, etc.). The Flask internals must be audited separately before D4.2.

### `eq_shell_bridge` cookie partitioning risk (Service)

`ShellReadySignal.tsx` notes that Chrome's cross-site iframe cookie partitioning can prevent `eq_shell_bridge` from being set. The component fires `EQ_SERVICE_READY` unconditionally when `window.parent !== window` to work around this, but the sidebar suppression logic (`!isShellIframe && <Sidebar>`) is server-side and depends on the cookie being readable. If the cookie is partitioned away, Service renders its sidebar inside the Shell iframe.

### No HubSidebar records on iframe/sub-pages

`HubLayout` (used by `FieldIframe`, `ServiceIframe`, `CardsIframe`, `EntityBrowserPage`, all admin pages) calls `<HubSidebar apps={sidebarApps} />` without a `records` prop. The RECORDS section only appears on the `TenantHome` page (`/:slug`). This is a pre-existing gap that D4.3 must fix — all HubLayout consumers need to receive the records prop for the sidebar to be consistent.

### Entity browser actions are limited

`MANAGEABLE_ENTITIES` in `EntityBrowserPage` is `{ customer, site, contact, asset }`. The drawer shows archive/unarchive/delete only for these. Field-managed entities (staff, schedule, timesheet, leave_request, licence) are read-only in Shell — edits require navigating into the Field iframe. This constraint must be documented in the D4.2 migration spec so users understand the boundary.
