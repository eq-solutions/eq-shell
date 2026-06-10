# Tech Mobile Path — Static Code Review

**Date**: 2026-05-21
**Reviewer**: Claude (Opus 4.7)
**Audience**: 1–5 technicians + Royce, full onboarding day, ~1 month runway
**Method**: Static code review of the technician daily-driver path. No live click-through.
**Goal**: Surface every mobile UX issue a tech will hit during the onboarding day, ordered by severity so they can be fixed in cohorts.

## Executive summary

The tech path is **mostly solid** — the foundations are right. PRs #156 (tech permission + TechDashboard + sidebar trim) and #158 (44px touch-target sweep) did a lot of the heavy lifting. The TaskRow pass/fail/NA buttons are well-engineered for gloved fingers. The sidebar drawer is properly managed for mobile. TechDashboard front-loads "My Upcoming Works" ahead of admin chrome.

**The one blocking issue** is in `AttachmentList` — there's no camera-capture hint on the file input, so when a tech tries to add a defect photo on a phone, they get a generic file picker instead of the camera opening directly. Two extra taps every photo, and the most common case is "take a picture right now."

The rest is polish: a handful of tap targets that are below 44px, a few cramped layouts on 375px screens, and some friction in the photo upload flow that could be smoother.

## Punch list — fix in this order

### Blocking (fix before the onboarding day)

| # | Severity | File | Issue | Fix sketch |
|---|---|---|---|---|
| 1 | **CRITICAL** | [components/ui/AttachmentList.tsx:144](components/ui/AttachmentList.tsx:144) | File input has no `capture="environment"` — defect photos require generic file picker on iPhone/Android. Camera doesn't open directly. | Add `capture="environment"` to the input. Either: (a) always set it (no harm on desktop); or (b) when `entityType` is `'defect'` or `'maintenance_check_item'` and the type is `'evidence'`. Recommend (a) — simplest, no downside. |
| 2 | **HIGH** | [components/ui/AttachmentList.tsx:149](components/ui/AttachmentList.tsx:149) | "Upload" button is `text-xs` (12px) plain link, no minimum height. Tap target is ~16–20px. Hard to hit on phone. | Promote to a Button component, `min-h-[44px]`, full-width on mobile. "+ Add photo" copy for evidence types. |
| 3 | **HIGH** | [components/ui/AttachmentList.tsx:235-249](components/ui/AttachmentList.tsx:235) | Download / delete icon buttons are `p-1.5` on a 14px icon → ~28px tap target. Under the 44px minimum. | Bump to `p-2.5` minimum, or wrap each icon in a `min-w-[44px] min-h-[44px] inline-flex items-center justify-center`. |
| 4 | **HIGH** | [app/(app)/maintenance/TaskRow.tsx:117](app/(app)/maintenance/TaskRow.tsx:117) | Inline notes editor is `h-6 px-1` (24px tall, 4px padding). On phone keyboard pops up + the field is hard to tap to start with + hard to read while typing. | Lift to a proper textarea sized `min-h-[44px]`, or a slide-up sheet for note editing. Either keeps the field 44px+ tall on tap. |
| 5 | **HIGH** | [app/(app)/maintenance/TaskRow.tsx:51](app/(app)/maintenance/TaskRow.tsx:51) | Grid `[1fr_152px_1fr]` on a 375px phone gives ~99px each for description + notes columns. Notes truncate aggressively; description wraps awkwardly. | Switch to a stack on mobile (`grid-cols-1` below `sm`), with buttons on their own row. Description full width, notes below, buttons big and centered. |

### Should fix (before the day if time)

| # | Severity | File | Issue | Fix sketch |
|---|---|---|---|---|
| 6 | MEDIUM | [components/ui/AttachmentList.tsx:164-211](components/ui/AttachmentList.tsx:164) | Type picker modal (Evidence / Reference / Paperwork) is an extra step for the common case "tech takes a photo of a defect" → that should always be Evidence with no prompt. | When `entityType` is `'defect'` or `'maintenance_check_item'`, skip the type picker entirely — default to `'evidence'` and upload immediately. Today the picker shows for every upload regardless of context. |
| 7 | MEDIUM | [components/ui/AttachmentList.tsx:218-256](components/ui/AttachmentList.tsx:218) | No image preview / thumbnail after upload — only the filename. A tech who's just taken three photos can't tell which is which without re-opening each. | Render a thumbnail (50×50) for `content_type.startsWith('image/')`. Calls existing `getAttachmentUrlAction`. |
| 8 | MEDIUM | [components/ui/AttachmentList.tsx:161](components/ui/AttachmentList.tsx:161) | Error display is a single `text-xs text-red-500` line above the list. Easy to miss on phone, no icon, no dismissal. | Promote to a small banner with the AlertCircle icon, dismiss button. Match the pattern used in import wizards. |
| 9 | MEDIUM | [app/(app)/maintenance/[id]/CheckDetailPage.tsx](app/(app)/maintenance/[id]/CheckDetailPage.tsx) | "Mark Complete" / "Complete All Assets" buttons live at the top of the page. After a tech scrolls through 40 task rows on a Jemena board, they have to scroll all the way back up to complete. | Sticky footer on mobile with the primary CTA. Pattern already exists in the new-check form (PR #173); reuse the SlidePanel sticky-footer pattern. |
| 10 | MEDIUM | [app/(app)/maintenance/page.tsx](app/(app)/maintenance/page.tsx) | The Mine / All filter defaults to Mine for techs (good), but the filter chips live in the header. On phone, they sit above the list and re-scroll the user back to the top whenever they toggle. | Sticky filter row at the top while scrolling; or default-collapsed filter sheet that the tech opens on demand. |

### Nice to have (polish only)

| # | Severity | File | Issue |
|---|---|---|---|
| 11 | LOW | [app/(app)/do/page.tsx](app/(app)/do/page.tsx) | Tiles use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. On 375px phones they stack single-column which is correct, but verify `sm:` (640px) doesn't fire on tablets in portrait. iPad portrait is 768px so it's fine, but worth confirming on the actual test devices. |
| 12 | LOW | [app/(auth)/auth/signin/SignInForm.tsx](app/(auth)/auth/signin/SignInForm.tsx) | Email field lacks `inputMode="email"`. Browsers usually infer from `type="email"` but iOS Safari sometimes shows a numeric keyboard if the user has had it open recently. Belt-and-braces. |
| 13 | LOW | [app/(auth)/auth/mfa/MfaChallengeForm.tsx](app/(auth)/auth/mfa/MfaChallengeForm.tsx) | Recovery code fallback (when TOTP isn't available) lacks `inputMode="numeric"` though recovery codes are also numeric. |
| 14 | LOW | [app/(app)/defects/DefectRow.tsx](app/(app)/defects/DefectRow.tsx) | Resolution notes textarea is `rows={2}` — usable but cramped on phone for any defect that requires a real write-up. Bump to `rows={4}` and `min-h-[88px]`. |
| 15 | LOW | Sign-out flow | Confirm there's no "are you sure?" modal on sign-out — on a phone with auto-lock that's friction. (Static review didn't reach a definitive answer; verify on a real device.) |

## Per-stop deep dive

### 1. Sign-in — [app/(auth)/auth/signin/](app/(auth)/auth/signin/)

- Server page wraps a client form (`SignInForm`).
- Submit button is `min-h-[44px]` + `touch-manipulation` — good.
- `autoComplete` set on email/password — good.
- **Polish**: add `inputMode="email"` on the email field for belt-and-braces.

### 2. MFA — [app/(auth)/auth/mfa/](app/(auth)/auth/mfa/)

- 6-digit code uses `inputMode="numeric"`, `autoComplete="one-time-code"` — perfect, iOS will auto-fill from SMS / Authenticator.
- Recovery code path is text input; consider `inputMode="numeric"` if the codes are numeric (verify code format).
- Per CLAUDE.md, MFA history is a regression watch — re-verify after any change.

### 3. /do — [app/(app)/do/page.tsx](app/(app)/do/page.tsx)

- Server component, role-aware tile ordering. Techs see "Create a check or test" first; admins see "Import data" first.
- Tiles are `min-h-[120px]`, single column on mobile — good touch surface.
- Description text is readable at mobile sizes.

### 4. Tech dashboard — [app/(app)/dashboard/TechDashboard.tsx](app/(app)/dashboard/TechDashboard.tsx)

- Heroic work in PR #149 — the tech sees "My Upcoming Works" immediately, not four screens of admin chrome.
- Welcome card on first login (PR I §B.6) — `showWelcome` prop, one-time, with a "open my first check" CTA. Excellent first-impression management.
- Hidden for techs: entity KPIs, defect summary, site map, service-credit widget. Right call.

### 5. Maintenance list — [app/(app)/maintenance/page.tsx](app/(app)/maintenance/page.tsx)

- Defaults to view=mine for techs (role-checked server-side).
- Filter chips at the top.
- **See #10** — sticky filter row on mobile.

### 6. Open a check — [app/(app)/maintenance/[id]/CheckDetailPage.tsx](app/(app)/maintenance/[id]/CheckDetailPage.tsx)

- Status accent bar full-bleed (`-mx-4 lg:-mx-8`) — good visual affordance.
- Asset table collapses above 10 items — progressive disclosure works well on phone.
- **See #9** — sticky footer CTA for "Mark Complete" / "Complete All Assets".

### 7. Tick tasks — [app/(app)/maintenance/TaskRow.tsx](app/(app)/maintenance/TaskRow.tsx)

- Pass/Fail/NA buttons are 44×44, `touch-manipulation`, `active:scale-90` — best-in-class for the tap surface.
- Optimistic local state so taps feel instant.
- **See #4 + #5** — notes field height + grid layout cramped on mobile.

### 8. Complete check — within CheckDetailPage

- Confirmation via `useConfirm()` dialog — verify modal sizes correctly on 375px viewport. Static review couldn't confirm; flag for live retest.

### 9. Raise a defect

- No dedicated `/defects/new` route — defects are created inline from the test/check workflow. Per the existing ACB/NSX patterns, calls `raiseTestDefectAction`.
- **See AttachmentList findings** — the photo flow is the part to fix.

### 10. Defect with photo — [components/ui/AttachmentList.tsx](components/ui/AttachmentList.tsx)

- **Top-of-list issue (#1)** — no `capture="environment"`.
- Also #2, #3, #6, #7, #8 above.

### Sign-out

- Static review couldn't fully verify the path. Quick live check recommended.

## Things that work well (don't break these)

- TaskRow's 44px pass/fail/NA buttons with `touch-manipulation` and `active:scale-90` — keep this exact pattern when fixing #4 + #5.
- TechDashboard front-loading "My Upcoming Works" — the "5-second first impression" is good.
- Sidebar mobile drawer (closes on nav, body scroll lock) — works correctly.
- MFA code input — `inputMode="numeric"` + `autoComplete="one-time-code"` is the gold standard for OTP entry on iOS.
- /do action hub — the role-aware tile launcher unifies what was previously scattered import + creation surfaces.
- First-login welcome card with "open my first check" CTA — exactly the right pattern for first-day onboarding.

## What this review did NOT cover

- Live click-through. Some issues only surface when the keyboard is open, when the camera roll has 1000 photos, when the network drops mid-upload.
- Offline behaviour. No service worker found in the static review; techs in basement plant rooms will hit this.
- Real-device tests. Static review can't measure: load time on a 4G connection, scroll performance on an iPhone SE, the actual look of `bg-eq-ice/40` on an OLED screen.
- Photo upload size limits. exceljs is for spreadsheets; the photo upload path may or may not have its own size cap.
- Sign-out friction. The static review didn't reach a definitive answer on whether there's a confirmation modal.

A real-device pass before the day is still recommended — likely 30 minutes on an actual iPhone with a real tech account.

## Suggested next actions

1. **Land the top 5 (blocking) as a single PR.** Five concentrated fixes, all touching AttachmentList + TaskRow. Probably one session of work.
2. **Land the should-fix items as a second PR.** Sticky footers, type-picker default, image previews. Another session.
3. **Real-device pass.** 30 minutes on a real phone before the day. Tag any new issues for a third polish PR.
4. **Dry-run with one tech.** A week before the day, walk the tech daily-driver path with one technician. Watch their hands. Note every hesitation.
