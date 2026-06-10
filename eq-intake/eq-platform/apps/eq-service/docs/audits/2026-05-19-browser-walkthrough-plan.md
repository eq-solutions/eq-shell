# Browser walkthrough plan — 2026-05-19

Working note for the overnight browser walkthrough. Executed against the
local Next.js dev server once `npm install` completes. Hits the real
production Supabase (`urjhmkhbgaxrofurpbgc`) via the copied `.env.local` —
**read-mostly**, demo-tenant writes only.

## Constraints

- **Demo tenant only for writes** — tenant_id `a0000000-0000-0000-0000-000000000001`. Per CLAUDE.md, this is the designed sandbox.
- **No real-tenant writes** — never sign in as a real SKS or Jemena user; if I land there by accident, sign out immediately.
- **Capture, don't fix** — every friction point logged, not auto-fixed. Posture override: trivial console-error fixes only if confidence is 100%.
- **Mobile + desktop both** — flip viewport between mobile (375x812) and desktop (1280x800) on key surfaces.

## Scenarios

### S1. Cold landing — unauthenticated user

| Step | Action | Capture |
|---|---|---|
| 1 | Navigate to `http://localhost:3000` | screenshot, console errors |
| 2 | Resize to mobile (375x812) | screenshot of mobile signin |
| 3 | Snapshot the page | a11y tree — verify tap targets exist |

**Validates:** the auth chooser landing (Finding §B.16 — "two clear tiles").

### S2. Tech cold-start via Demo

| Step | Action | Capture |
|---|---|---|
| 1 | From signin, click "Try the demo" | screenshot, network (look for shell-login or supabase auth) |
| 2 | Land on dashboard | screenshot — desktop AND mobile |
| 3 | Snapshot sidebar | a11y tree — count items |
| 4 | Check what role I have | inspect `[data-role]` or read page header |
| 5 | Click "Maintenance" sidebar | screenshot of list |
| 6 | Look for "Mine / All" toggle | snapshot — confirm absent (Finding §B.2) |
| 7 | Click a check (any) | screenshot of detail page |
| 8 | Inspect TaskRow pass/fail button sizes | preview_inspect for `width`, `height` |
| 9 | Validate disabled "Complete Check" hover-only reason | screenshot — disabled state |

**Validates:** Findings §B.2 (no mine filter), §B.3 (dashboard burying), §B.4 (sidebar noise), §B.8 (28px tap targets), §B.9 (hover-only disabled reason).

### S3. Admin cold-start signs

Note: probably can't fully exercise this without an empty tenant. Best
case: poke admin surfaces on the demo tenant if I land there as admin
(unlikely — demo gives non-admin), or sign in with admin credentials if
I have them.

| Step | Action | Capture |
|---|---|---|
| 1 | If admin role: navigate `/customers` | screenshot |
| 2 | Click "Add Customer" | screenshot of slide-panel |
| 3 | Inspect form validation timing | network — submit with bad input, capture response |
| 4 | Navigate `/customers/[id]` | screenshot — confirm no "Add Site" CTA (§A.4) |
| 5 | Navigate `/sites?customer_id=X` | screenshot — confirm form doesn't pre-fill (§A.5) |
| 6 | Navigate `/job-plans` → Add | screenshot — confirm Items section not visible (§A.3) |

**Validates:** §A.3 (zero-item plan), §A.4 (no Add CTAs), §A.5 (no prefill), §A.10 (CreateCheckForm density).

### S4. /testing/rcd/[id] permission check

Critical — this is the P0 bug from the audit.

| Step | Action | Capture |
|---|---|---|
| 1 | If role=technician: navigate to a known RCD test in demo data | screenshot |
| 2 | Confirm Edit button is hidden or disabled | screenshot + a11y snapshot |
| 3 | Inspect why | console + page source via preview_eval |

**Validates:** §B.10 / §2.1 (RCD editor blocks technicians).

### S5. Mobile sidebar drawer

| Step | Action | Capture |
|---|---|---|
| 1 | Resize to mobile, navigate to `/dashboard` | screenshot — top bar with hamburger |
| 2 | Click hamburger | screenshot — drawer open |
| 3 | Inspect sidebar entry padding | preview_inspect |

**Validates:** sidebar 36px tap targets (§B.4 / §2.6).

## Findings template

For each new finding (i.e. NOT already in the 2026-05-18 audit), capture:

- **What:** observation
- **Where:** URL + selector
- **Persona impact:** brand-new tech / experienced tech / apprentice / admin
- **Screenshot:** link or filename in `docs/audits/screenshots/`
- **Console errors:** any
- **Network errors:** any

## Output

Findings appended to the morning report at
`docs/audits/2026-05-19-overnight-report.md` under a "Browser walkthrough"
section. Screenshots committed under `docs/audits/screenshots/` so PRs
can reference them.
