# D4.2 — Records-into-Shell IA Migration Spec

**Date:** 2026-05-31 | **Decisions locked:** 2026-06-01
**Status:** PARTIALLY APPROVED — OQ-1 (Field nav) is on hold pending discussion. OQ-2 to OQ-6 locked.
**Depends on:** D4.1 IA audit (`docs/d4-1-ia-audit.md`)
**Feeds into:** D4.3 Records IA build (phased)

## Confirmed decisions (2026-06-01)
| # | Question | Decision |
|---|---|---|
| OQ-1 | Field v3.5.40 nav suppression | **HOLD** — removal was deliberate. D4 Phase 1 (Field `?embedded=1`) requires discussion before build. |
| OQ-2 | Assets consolidation | Keep both surfaces with clearer labels (lowest risk, Phase 2). |
| OQ-3 | Assets in RECORDS sidebar | Separate — EQUIPMENT stays as its own sidebar section. |
| OQ-4 | Quotes sidebar | No sidebar in Quotes Flask app — no action needed. |
| OQ-5 | Service /records hub | Decide after Phase 1 is stable. |
| OQ-6 | Phase 1 Field deploy timing | EQ Field has no live EQ users; only SKS uses Field. SKS deploy window TBD with Royce. |

### Phase 1 hold — context needed
OQ-1 answer: "deliberate". Before Phase 1 can proceed, need to understand why Field was changed in v3.5.40 to always show its own nav, and whether the intent is for Field to always be a standalone-feeling app even when inside Shell, or if suppression should return with a better mechanism. Phase 2 and Phase 3 can proceed independently.

---

## 1. Single Nav Owner Table

Final-state ownership for each record/feature type. "Shell" means the record list lives in Shell's sidebar and `EntityBrowserPage`; "App" means it stays inside the iframe app's own nav and Shell does not surface it independently.

| Record / Feature | Current Owner | Final Owner | Notes |
|---|---|---|---|
| Customers | Shell + Service (dup) | **Shell** | Shell `EntityBrowserPage` is the canonical list; Service keeps internal detail views via iframe nav |
| Sites | Shell + Field (dup) + Service (dup) | **Shell** | Same canonical table; iframe apps retain detail/edit screens |
| Contacts | Shell + Field (dup) + Service (dup) | **Shell** | Same canonical table |
| Assets / Equipment | Shell (two surfaces) + Service | **Shell** (consolidated) | Merge `/:slug/equipment` and `/:slug/data/asset` — see Section 3 open question |
| Staff (people) | Field only | **Field** | Field-managed; Shell `EntityBrowserPage` exposes read-only at `/data/staff` but does not surface it in the sidebar |
| Timesheets | Field only | **Field** | Labour-hire data boundary |
| Leave requests | Field only | **Field** | Labour-hire data boundary |
| Supervision / Roster | Field only | **Field** | Roster logic is Field-specific |
| Safety / Safety Report | Field only | **Field** | Field-specific compliance feature |
| Teams | Field only | **Field** | Flag-gated Field feature |
| Licences | Field only | **Field** | Field-managed; Shell has `/data/licence` read-only |
| Projects | Field only | **Field** | Flag-gated; no Shell equivalent |
| Forecast | Field only | **Field** | Flag-gated; no Shell equivalent |
| Job Numbers | Field only | **Field** | Beta; no Shell equivalent |
| Apprentices | Field only | **Field** | Beta; no Shell equivalent |
| Maintenance (work orders) | Service only | **Service** | CMMS-specific; Shell does not absorb this |
| Maintenance Plans / Job Plans | Service only | **Service** | CMMS-specific |
| Defects | Service only | **Service** | Flag-gated Service feature |
| Calendar | Service + Field (independent) | **App** (per app) | Both apps have their own calendar context; Shell does not consolidate |
| Insights (analytics, commercials) | Service only | **Service** | Role-gated; distinct from GM Reports |
| Do (action hub) | Service only | **Service** | Service-specific quick-action surface |
| Search | Service only | **Service** | Full-text search scoped to Service data |
| GM Reports | Shell only | **Shell** | Already in Shell at `/:slug/reports` |
| Intake (import) | Shell only | **Shell** | Already in Shell at `/:slug/intake` |
| Admin | Shell + Service (separate) | **Shell** (Shell users); **Service** (Service-specific config) | Service admin covers Service-only settings; Shell admin covers tenant/users |

**Key principle:** Shell owns the cross-app record surfaces (customers, sites, contacts, assets). The iframe apps own their domain-specific features and operational screens. Shell does not try to absorb CMMS operations or Field labour-hire features.

---

## 2. The Double-Menu Problem

### Where it currently occurs

There is exactly one active double-menu situation: **the `/field` route**.

When a user navigates to `/:slug/field` in Shell:
- Shell renders `HubSidebar` on the left (RECORDS, EQUIPMENT, APPS, ADMIN sections).
- Inside the iframe, EQ Field renders its own full sidebar (20+ items), its own topbar, and a mobile nav drawer.

The user sees two navigation panels side by side. The inner Field sidebar is a complete, functional nav that duplicates the outer Shell sidebar's chrome and includes routes (My Schedule, Calendar, Leave, Safety, etc.) that have no Shell equivalent.

### Why it occurs

EQ Field previously suppressed its sidebar in shell mode via a CSS class (`shell-mode`) applied to `<html>`. This was removed in v3.5.40. The suppression removal appears intentional based on the changelog note ("Field now shows its own sidebar/topbar/mobile-nav whether loaded standalone or inside the EQ Shell iframe").

⚠ Open question: Was the v3.5.40 removal of `shell-mode` nav suppression a deliberate product decision by Royce, or a temporary measure pending a better approach? The answer determines whether Phase 1 below is approved work or needs a conversation first.

### Where it does NOT occur

- **EQ Service:** Sidebar is conditionally removed from the DOM server-side when `eq_shell_bridge=1` cookie is present. Solved.
- **EQ Cards:** Flutter app has no sidebar equivalent.
- **EQ Quotes:** Unknown. ⚠ Open question — see Section 7.

---

## 3. Proposed Solution for Iframe Nav Suppression

Three options exist. They are not mutually exclusive — the recommended approach combines two.

### Option A — postMessage flag (Shell → iframe on load)

Shell sends `{ type: 'EQ_SHELL_EMBEDDED', version: 1 }` to the iframe's `contentWindow` after the handoff completes. The iframe app listens and hides its nav on receipt.

**Pros:** No URL pollution; Shell controls the signal timing; works for token mode and cookie mode alike.

**Cons:** Field is a vanilla JS app — it needs a new `window.addEventListener('message', ...)` block. The signal can arrive after the sidebar has already painted (brief flash of the sidebar before it hides). Also, `sandbox="allow-same-origin allow-scripts"` is required for postMessage to work cross-origin — current Field iframe has both, so this is fine.

### Option B — URL param (`?embedded=1`)

Shell appends `?embedded=1` to the iframe src. The app reads it on mount and hides its nav immediately, before first paint. Applies to both cookie and token auth modes.

For Field: `buildFieldSrc` and `buildFieldCookieSrc` in `src/lib/fieldTenants.ts` would append the param. Field's `auth.js` or a new init block reads `URLSearchParams` and sets the `shell-mode` class before rendering.

**Pros:** No postMessage dependency; suppression fires before first paint (no flash). Simpler to implement in vanilla JS.

**Cons:** The `?shell=1` param already exists for Field cookie-mode detection — adding `?embedded=1` is redundant but cleaner to keep separated. For Service (Next.js), a URL param works and can be read server-side, enabling server-rendered suppression consistent with the current `eq_shell_bridge` approach.

### Option C — JWT payload flag (`"embedded": true` claim)

Add an `embedded` boolean to `ShellTokenPayload` (Field) and `ServiceTokenPayload` (Service). The iframe app reads it from the validated token and suppresses nav.

**Cons:** Only applies to token-mode auth paths. Cookie-mode paths (current Field on `field.eq.solutions`, Service on `service.eq.solutions`) would need a parallel mechanism. Also expands the token shape — any `ShellTokenPayload` change requires Field's `verify-pin.js` to be updated in lockstep (downstream risk per CLAUDE.md). Not recommended for this purpose.

---

### Recommendation: Option B (URL param) as primary, Option A (postMessage) as fallback

**Rationale:**

1. **Field (vanilla JS, token mode):** `?embedded=1` can be appended to `buildFieldSrc()` today — it requires one line in `src/lib/fieldTenants.ts` and one block in Field's `auth.js` to read it. It fires before first paint. The `shell-mode` HTML class mechanism already exists in Field's `auth.js`; it just needs the CSS rules that consume it to be reinstated (or the param to trigger new suppression logic).

2. **Field (cookie mode):** `buildFieldCookieSrc()` already appends `?tenant=<slug>&shell=1`. Adding `&embedded=1` is one character change. No Field auth-path differences.

3. **Service (Next.js, cookie mode):** Service's layout already reads `eq_shell_bridge` cookie server-side. The URL param (`?embedded=1`) is a clean alternative for deploy-preview environments where the cookie may be partitioned. In production cookie mode, `eq_shell_bridge` remains the primary mechanism.

4. **Option A (postMessage) as fallback:** Shell should also send `EQ_SHELL_EMBEDDED` postMessage after handoff completes (after `accepted` phase for Field, after `EQ_SERVICE_READY` for Service). This covers any race condition where the URL param is missed on internal navigation within the iframe app.

5. **Option C is rejected:** Expanding `ShellTokenPayload` for this purpose cross-couples the token contract to a UI concern and risks Field's `verify-pin.js` breaking if the shape drifts.

**Token shape impact:** None. No changes to `ShellTokenPayload`, `ServiceTokenPayload`, or `token.ts` are required for Phase 1.

---

## 4. Migration Phases

### Phase 1 — Suppress iframe nav (quick win, kill the double menu)

**Scope:** EQ Field only. Service is already solved.

**Shell changes (eq-shell):**
1. In `src/lib/fieldTenants.ts`: append `&embedded=1` to both `buildFieldSrc()` and `buildFieldCookieSrc()` outputs.
2. In `src/pages/FieldIframe.tsx`: after `accepted` phase is reached, send postMessage `{ type: 'EQ_SHELL_EMBEDDED', version: 1 }` to `iframeRef.current?.contentWindow`. Target origin = `new URL(src).origin`.

**Field changes (eq-solves-field):**
1. In `auth.js` `_consumeShellToken()` (token mode): after setting `eq_shell_mode` sessionStorage, also check `new URLSearchParams(location.search).get('embedded')` and add `shell-mode` class unconditionally when either is set.
2. In cookie-mode boot path (no `#sh=`): read `?embedded=1` on DOMContentLoaded, apply `shell-mode` class if present.
3. Reinstate CSS rules in the `shell-mode` class scope to hide `.sidebar`, `.topbar`, and `.mobile-nav-drawer`. These rules existed before v3.5.40 and their removal is the root cause of the current double-menu.
4. Add `window.addEventListener('message', ...)` handler: on `{ type: 'EQ_SHELL_EMBEDDED' }` from `core.eq.solutions` origin, add `shell-mode` class if not already set (postMessage fallback).

**SKS note:** SKS uses token mode (`sks-nsw-labour.netlify.app`, not `.eq.solutions`). The `?embedded=1` param will appear in the Field URL for SKS users. Field must apply the suppression class regardless of auth path. This is safe — SKS users are always inside Shell when accessing Field via Shell. Any user accessing Field directly (standalone, not through Shell) will not have `?embedded=1` in the URL and will see the full sidebar as before.

**Rollback:** Remove `&embedded=1` from `buildFieldSrc`/`buildFieldCookieSrc`. Field's CSS suppression is no-op without the class being added. The `shell-mode` class addition is conditional on the param or postMessage — standalone Field users are unaffected.

**Deploy order:** Field must ship first (or simultaneously). If Shell ships first with `&embedded=1` but Field doesn't have the listener, Field will ignore the param and continue showing its sidebar — no regression, just the existing double-menu. Safe to roll out incrementally.

---

### Phase 2 — Move orphaned record types into Shell sidebar

**Scope:** Shell sidebar RECORDS section currently shows only Customers, Sites, Contacts. `HubLayout` consumers (iframe pages, admin pages, entity browser) receive no `records` prop, so the RECORDS section disappears when the user navigates away from the home page.

**Shell changes:**
1. Extract `sidebarRecords` config from `TenantHome.tsx` into a shared constant (e.g., `src/lib/sidebarConfig.ts`).
2. Pass that constant as the `records` prop to `HubLayout` in all consumers: `FieldIframe.tsx`, `ServiceIframe.tsx`, `CardsIframe.tsx`, `QuotesIframe.tsx`, `EntityBrowserPage.tsx`, all admin page layouts.
3. Evaluate whether to add Assets to `sidebarRecords`. Currently the EQUIPMENT section (`/:slug/equipment`) and the entity browser (`/:slug/data/asset`) are separate. Decision required — see Section 7.
4. Do not surface Field-only entities (staff, timesheets, licences, etc.) in the Shell sidebar. They are read-only in Shell's `EntityBrowserPage` but should not appear in the sidebar nav.

**No iframe app changes required for Phase 2.**

**Rollback:** Reverting the `sidebarConfig` change restores the current behaviour. No data changes.

---

### Phase 3 — Retire redundant iframe nav (once Shell owns everything)

**Scope:** After Phase 1 (Field sidebar suppressed) and Phase 2 (Shell sidebar consistent across all pages), evaluate removing the redundant record entries from Service's internal `/records` hub and Field's nav items that duplicate Shell-owned records.

**Service:** The `/records` hub page links to `/customers`, `/sites`, `/contacts`, `/assets`. When Shell owns these surfaces, the iframe's internal routes become secondary access paths. Decision: keep them as deep-links within the iframe (user arrives at a customer via the Service sidebar internally when already inside Service), or suppress them from the Service sidebar when embedded.

Service already suppresses its sidebar when `isShellIframe=true`. This means Phase 3 for Service is already done — the internal `/records` nav is not visible to Shell users. No further action needed unless the sidebar suppression mechanism is changed.

**Field:** After Phase 1 (suppression reinstated), Field's Sites and Contacts nav items are hidden from Shell users. Those items remain in Field's standalone experience. No further removal needed — they serve standalone Field users.

**Phase 3 is low priority.** It is cleanup, not a functional improvement. Do not schedule until Phase 1 and Phase 2 are stable in production.

---

## 5. Risk Table

### EQ Field

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| `shell-mode` CSS reinstated incorrectly — hides nav in standalone Field | Medium | High — standalone users lose nav | Condition class on `?embedded=1` param OR `EQ_SHELL_EMBEDDED` postMessage only; standalone Field never gets either | Remove `?embedded=1` from Shell `buildFieldSrc` |
| SKS token-mode users see suppressed nav when they shouldn't | Low | High for SKS | SKS users access Field only through Shell; standalone SKS Field URL does not include `?embedded=1` | Same as above |
| CSS specificity conflict with Field's existing `shell-mode` rules (if any remain from v3.5.22) | Low | Low — double-hidden nav | Audit Field CSS before reinstating rules | Scoped CSS, no global risk |
| Field `auth.js` param-reading runs before DOM ready | Low | Low — class added late, brief flash | Move class add to top of init, before sidebar render | postMessage fallback catches it |
| postMessage from wrong origin accepted by Field | Low | Medium — spoofed suppression | Field must check `event.origin === 'https://core.eq.solutions'` strictly | Origin check is required implementation |

**SKS flag:** Any Field deploy for Phase 1 must be tested against the SKS token-mode flow (`sks-nsw-labour.netlify.app`). SKS is a live production tenant. Test plan: log in as SKS user via Shell → Field → confirm Field sidebar is suppressed → log in as SKS user directly at sks-nsw-labour.netlify.app → confirm Field sidebar is visible.

### EQ Service

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| `eq_shell_bridge` cookie partitioned by Chrome (third-party iframe) | Medium | Medium — Service shows sidebar inside Shell | Already mitigated by `EQ_SERVICE_READY` unconditional fire; `ShellReadySignal` is in place | Monitor; if partitioning breaks production, move to URL param (`?embedded=1`) |
| Service `/records` hub routes become unreachable from Shell nav | Low | Low — Shell nav replaces them | Phase 2 (Shell sidebar fix) precedes any Service nav changes | No Service change needed for Phases 1–2 |
| Cookie-mode `proxy.ts` session setup fails and sidebar renders for auth-failed user | Low | Low — visible sidebar, not a security issue | Auth failure shows error page, not content | Auth is separate from sidebar concern |

### EQ Cards

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| No sidebar in Flutter; no action required for Phases 1–2 | — | — | — | — |

### EQ Quotes

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| Flask sidebar suppression status unknown | High (unknown) | Medium if sidebar visible | Flask internals must be audited before Phase 1 sign-off | `?embedded=1` appended to Quotes src; Flask must consume it |

⚠ Open question: Does EQ Quotes render a sidebar? The `QuotesIframe.tsx` sets `?shell=1` in the URL. What does the Flask app do with this? Audit required before D4.3 build starts.

---

## 6. Contract Changes

The following changes to the Shell↔iframe contract are required. Reference: `eq-context/cross-repo-contracts-2026-05-31.md` (file does not exist yet — this spec is a source of new contract terms to be written there).

### New postMessage events

| Direction | Event type | Payload | Purpose | Phase |
|---|---|---|---|---|
| Shell → iframe | `EQ_SHELL_EMBEDDED` | `{ type: 'EQ_SHELL_EMBEDDED', version: 1 }` | Tells iframe it is embedded; app should suppress its own nav | Phase 1 |

Existing postMessage events are unchanged:
- `EQ_SERVICE_READY` (iframe → Shell) — no change
- `EQ_SERVICE_ERROR` (iframe → Shell) — no change
- `REQUEST_SHELL_TOKEN` (iframe → Shell) — no change
- `SHELL_TOKEN_RESPONSE` (Shell → iframe) — no change
- `eq-field-shell-handoff` (iframe → Shell, various kinds) — no change

### New URL params

| Param | Value | Applies to | Purpose | Phase |
|---|---|---|---|---|
| `embedded` | `1` | Field (token + cookie mode), Quotes | Tells iframe it is embedded; app suppresses nav before first paint | Phase 1 |

Existing URL params unchanged:
- `?tenant=<slug>` (Field) — no change
- `?shell=1` (Field cookie mode, Cards, Quotes) — no change
- `#sh=<token>` (Field token mode, Service token mode) — no change

### JWT / token shape changes

**None for Phase 1 or Phase 2.** The `ShellTokenPayload`, `ServiceTokenPayload`, and `SessionPayload` shapes in `netlify/functions/_shared/token.ts` are not modified. The `embedded` signal is carried in the URL param and postMessage, not in the token.

⚠ Open question: If a future phase requires the token to carry the `embedded` flag (e.g., for server-side suppression in a new iframe app), the right field name is `embedded: true` added to the relevant payload interface. This would require a coordinated Field deploy to avoid `verify-pin.js` rejecting the new shape — but since unknown fields in JSON.parse are ignored, it is safe to add fields to the token without a breaking change.

### `eq-context` seam map updates needed

Once this spec is approved, the following should be added to `eq-context/cross-repo-contracts-2026-05-31.md`:
1. `EQ_SHELL_EMBEDDED` postMessage event definition and timing
2. `?embedded=1` URL param: which apps consume it, what they do
3. Confirmation that `ShellTokenPayload` is stable (no `embedded` field added)

---

## 7. Open Questions for Royce

These decisions must be made before D4.3 build starts. Numbered for reference.

**OQ-1 — Was the v3.5.40 removal of Field nav suppression intentional?**

The D4.1 audit found that Field's `shell-mode` CSS rules were removed in v3.5.40 ("Field now shows its own sidebar/topbar/mobile-nav whether loaded standalone or inside the EQ Shell iframe"). If this was a deliberate product decision (e.g., you wanted Field to always show its full nav even when embedded), then Phase 1 of this spec needs your sign-off to reverse it. If it was a temporary measure, Phase 1 proceeds as written.

**OQ-2 — Assets: consolidate or keep two surfaces?**

Shell currently has:
- `/:slug/equipment` (EquipmentModule) — calibration register, service-due focus
- `/:slug/data/asset` (EntityBrowserPage) — generic table view

Service has `/assets` — electrical assets with maintenance-plan linkage.

All three read from `app_data.assets` but with different column emphasis. Options:
- A. Keep both Shell surfaces with explicit labelling ("Plant & Equipment" vs "Asset register")
- B. Merge into a single `/:slug/assets` with tabs or filter for equipment vs. other
- C. Shell owns the list (`/:slug/assets`); Service's `/assets` becomes a deep-link into the iframe

Recommendation: Option A (keep separate, clarify labels) is lowest risk for Phase 2. Consolidation is a D4.3+ decision.

**OQ-3 — Should the Shell sidebar RECORDS section show Assets?**

Currently only Customers, Sites, Contacts appear under RECORDS. Assets is accessible via the EQUIPMENT section (same thing, different label). Should "Assets" appear in the RECORDS sidebar? Or does EQUIPMENT cover it?

**OQ-4 — EQ Quotes sidebar status**

Does the Flask Quotes app render a sidebar or nav that is visible when embedded in Shell? If yes, does `?shell=1` suppress it, or does `?embedded=1` need to be added?

**OQ-5 — Service `/records` hub after Phase 2**

After Phase 2 (Shell sidebar carries records consistently on all pages), Service's `/records` internal hub becomes a secondary access path for Shell users. Should it be left as-is (Service suppresses its sidebar when embedded, so Shell users never see it directly), or should the `/records` hub be removed from Service's internal nav to avoid confusion for users who open Service in a new tab?

**OQ-6 — Timing for Phase 1 Field deploy**

Phase 1 requires a Field deploy (eq-solves-field). That deploy touches `auth.js` and CSS — both load-bearing for SKS in token mode. Who is the deployer? When is the deploy window? The Shell side of Phase 1 can ship first (or simultaneously) without risk, but Field must not ship without the Shell `?embedded=1` param being in production (otherwise the class is never added and the suppression never fires, which is fine — it is the current state).

---

## Appendix — Current token shapes (reference)

### `ShellTokenPayload` (Field iframe token)
```typescript
{
  kind: 'shell-token';
  name: string;
  role: 'staff' | 'supervisor';       // legacy 2-tier
  eq_role: EqRole;                     // 5-tier, Field ignores today
  is_platform_admin: boolean;
  tenant_slug: string;
  exp: number;
}
```
Source: `netlify/functions/_shared/token.ts`. No changes proposed for D4.2.

### `ServiceTokenPayload` (Service iframe token)
```typescript
{
  kind: 'service-token';
  email: string;
  name: string | null;
  eq_role: EqRole;
  is_platform_admin: boolean;
  shell_tenant_id: string;
  exp: number;
}
```
Source: `netlify/functions/_shared/token.ts`. No changes proposed for D4.2.

### Field handshake postMessage (Field → Shell)
```typescript
{
  source: 'eq-field-shell-handoff';
  version: 1;
  kind: 'boot' | 'no-sh-param' | 'accepted' | 'rejected' | 'http-error' | 'network-error' | 'tenant-mismatch';
  hasHash?: boolean;
  status?: number;
  name?: string;
  role?: string;
  detail?: string;
  expected?: string;
  got?: string;
}
```
Source: `src/pages/FieldIframe.tsx`. No changes proposed for D4.2.
