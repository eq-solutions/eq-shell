# Spec: Suite icon rail
**Status:** APPROVED — decisions locked 2026-06-01. Ready for D3.3 build.
**Design ref:** `EQ.html` (Direction D handoff bundle — "Suite rail" screen)
**Task:** D3.1 → feeds into D3.3 build wave

## Confirmed decisions (2026-06-01)
| # | Question | Decision |
|---|---|---|
| Q1 | TenantHome | Iframe pages only — TenantHome keeps its current full sidebar |
| Q2 | Expand trigger | Hover to expand (handoff pattern) |
| Q3 | Records icon | No — Records stays in TenantHome sidebar only |
| Q4 | Quotes trial tier | Show greyed out with "Upgrade" tooltip |
| Q5 | Mobile | Build bottom tab bar in D3.3 |

---

## What it is

A narrow vertical icon bar — 48–56px wide — persistent on the left edge of Shell across all modules. Each icon represents a module entry point. Hovering expands the icon to show its label. Clicking switches to that module. The active module's icon is highlighted.

This is the cross-app switcher, not an in-app sidebar. It sits at the top of the visual layer — above the per-app sidebar that Service or Field may render inside the iframe.

---

## Relationship to the current sidebar (`HubSidebar`)

The current Shell has a full-width sidebar (`HubSidebar.tsx`) that shows on the TenantHome page. When a module iframe is open (Field, Service, Cards, Quotes), the Shell chrome is minimal — the iframe fills the screen.

The icon rail replaces/complements that full sidebar for the iframe views. The design handoff is explicit: "avoid the double left-menu." The rule is:

- **On the Shell home page (TenantHome):** The existing `HubSidebar` stays (it has Records, Equipment, Apps, Intake, Reports, Admin sections). The icon rail does not appear here — it would duplicate the app list.
- **On iframe module pages (Field, Service, Cards, Quotes):** The `HubSidebar` is hidden. The icon rail appears instead — 48–56px wide, flush left. The iframe content fills the rest.

This means the icon rail is rendered by `HubLayout` when `iframe={true}` is passed, and is absent from the TenantHome layout. Confirm this split with Royce before building.

---

## Layout

### Rail container

- Width: 48px collapsed, 200px expanded (hover/focus state).
- Height: 100vh, sticky.
- Background: `#1A1A2E` (ink — dark sidebar matches current brand shell chrome).
- The rail is a `<nav>` element with `aria-label="App navigation"`.
- Transition: width 150ms ease (per token motion spec). Honour `prefers-reduced-motion` — if reduced motion, skip the width animation and show labels immediately or use opacity fade only.

### Items in order (top to bottom)

| Icon | Module | Lucide icon | Route |
|---|---|---|---|
| EQ logo mark | Shell home | — (EQ logo SVG) | `/{tenantSlug}` |
| Field | EQ Field | `Users` | `/{tenantSlug}/field` |
| Service | EQ Service | `Wrench` | `/{tenantSlug}/service` |
| Quotes | EQ Quotes | `FileText` | `/{tenantSlug}/quotes` |
| Cards | EQ Cards | `CreditCard` | `/{tenantSlug}/cards` |

The icon map already exists in `HubSidebar.tsx` (`HUB_APP_ICONS`). Reuse those icons.

Separator below the EQ logo. Modules below the separator.

Bottom of rail (pinned to bottom):
- Settings icon (`Settings`) → `/{tenantSlug}/admin/settings` (visible to admin+ only)
- User avatar (initials circle, same as current sidebar) — clicking opens a small popover: "Sign out" button.

### Each item

Collapsed (default): 48px wide, centred icon (Lucide, 20px, stroke 2, white).

Expanded (on rail hover or keyboard focus): rail widens to 200px. Icon shifts left (16px inset), label appears to the right (14px, weight 500, white). 150ms ease.

Active state (current module): left border 3px solid `#3DA8D8` (sky). Icon and label: sky colour instead of white. Background: subtle — `rgba(61,168,216,0.10)`.

Hover state (non-active items): background `rgba(255,255,255,0.06)`. No label expansion on individual item hover unless the whole rail is in expanded state.

Tooltip: when rail is collapsed, a tooltip appears on item hover (right side, 8px offset): module name. Use the native `title` attribute or a lightweight CSS tooltip — no JS library needed at this scale.

---

## Route awareness

The active icon is determined from the current URL path segment (second segment after tenantSlug):

```
/{tenantSlug}/service/... → active: service
/{tenantSlug}/field → active: field
/{tenantSlug} → active: none (home icon highlighted instead)
```

In React Router terms, match with `useMatch('/:tenantSlug/:module/*')` and compare `module` to each item's key.

The `NavLink` component from React Router provides `isActive` — use this rather than manual matching where possible.

---

## Behaviour when an iframe module is shown

The Service, Field, Cards, and Quotes pages render iframes. The icon rail sits outside the iframe (in Shell's own DOM). Clicking a different icon navigates Shell to a different module — the current iframe is unmounted and the new one mounts.

There is no need for postMessage communication between the rail and the iframe for navigation. Navigation is Shell-side.

One consideration: if the iframe has unsaved state (e.g. a user was mid-form in Service), switching modules will lose that. This is an existing behaviour with the current Shell navigation — the icon rail does not make it worse. Document this as a known limitation. A future improvement (out of scope for D3.3) would be a `beforeunload`-style postMessage to warn the user.

---

## Responsive behaviour

- Desktop (≥ 1024px): rail is visible, collapsed by default.
- Tablet (768–1023px): rail visible, always collapsed (no hover-expand — tap icon to navigate, label not shown). Tooltip appears on tap before navigation — add a 300ms delay before navigation to let the user see the tooltip. Or skip the tooltip delay and just navigate immediately (simpler, acceptable).
- Mobile (< 768px): rail hides. A bottom tab bar replaces it (separate spec — out of scope for D3.3). For now, on mobile, the existing mobile navigation approach (hamburger or no persistent nav) stays.

---

## Key components

- `NavLink` (React Router) — for routing and active state
- Lucide icons: `Users`, `Wrench`, `FileText`, `CreditCard`, `Settings` (all already imported in `HubSidebar.tsx`)
- EQ logo mark SVG (from `EqLogo` component — use the mark/icon variant, not full wordmark)
- Inline CSS or a dedicated `.eq-icon-rail` stylesheet block (follows existing Shell CSS convention — no Tailwind in Shell)

No `@eq-solutions/ui` components are required for the rail itself — it is Shell chrome, not app-level UI.

---

## Accessibility

- `<nav aria-label="App navigation">`
- Each item is an `<a>` (via `NavLink`) — keyboard-navigable.
- Active item: `aria-current="page"` on the active `NavLink`.
- Icon: `aria-hidden="true"`, label text is the accessible name.
- When collapsed, the label is visually hidden but present in the DOM for screen readers (use a `.sr-only` class, not `display:none`).
- Focus ring: `0 0 0 2px rgba(61,168,216,0.40)` 2px offset (per token spec, already in `eq-tokens.css`).

---

## D4 consideration

The design handoff note on the shell home vs icon rail: "the Shell home itself should not show both the icon rail and a duplicate shell menu — reconcile so there's one clear nav per context."

For D3.3, the simplest implementation is: icon rail appears only in `HubLayout` when `iframe={true}`. The TenantHome (which uses `HubLayout` without `iframe`) keeps its current `HubSidebar`.

The D4 IA audit (task D4.1) will decide whether TenantHome itself should be restructured to use the icon rail + a right-side content area, replacing `HubSidebar`. Do not pre-empt that decision in D3.3. Build the icon rail as an addition to the iframe wrapper only.

---

## Open questions for Royce

1. **Rail on TenantHome**: Should the icon rail appear on the Shell home page (TenantHome), or only on iframe module pages? The spec recommends iframe-only for D3.3 to avoid the double-menu problem. Confirm.

2. **Expanded state trigger**: Should the rail expand on hover of the entire rail (any part of the 48px strip) or only on intentional toggle (a click/keyboard shortcut)? Hover-expand is the design handoff pattern — confirm this is acceptable UX given that accidental hover on a narrow rail can cause layout jitter.

3. **Records module icon**: Should there be an icon in the rail for "Records" (Customers, Sites, Contacts)? The current sidebar has a Records section with sub-links. If Records is a top-level module in the rail, what Lucide icon and what route? Alternatively, Records stays in the TenantHome sidebar only (not the rail) — which keeps the rail to the 5 app modules above.

4. **Quotes visibility**: Quotes is hidden for trial tier users (`hideForTier: ['trial']` in TenantHome). The icon rail should respect the same visibility rule. Confirm: hide Quotes icon entirely for trial users, or show it greyed out with a "Not available on your plan" tooltip?

5. **Mobile bottom tab bar**: Is a mobile bottom tab bar needed for D3.3 or deferred? If deferred, confirm that mobile users on an iframe module page have some way to switch modules (e.g. a hamburger that opens the rail as a drawer).
