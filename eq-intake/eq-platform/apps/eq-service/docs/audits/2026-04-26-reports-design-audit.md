# Reports Design Audit — 2026-04-26

> **Status as of 2026-04-27:** all audit items closed in code (see fix order
> below — every numbered item has a commit). One item is partial: S2 full
> tenant-aware ice is implemented for `pm-check-report.ts` only; the other
> four affected generators use `EQ_ICE` (the brief default) rather than a
> tenant-derived ice. The visual difference is small enough on shared-CPU
> DOCX rendering that it wasn't worth threading through the deeper builder
> hierarchies tonight; pattern is documented for future revival.
>
> Royce confirmed Option A on the semantic colours open question — pass
> `#16A34A`, fail `#DC2626`, warn `#D97706`. Tokens live in
> `lib/reports/colours.ts` and should be added to the brief in v1.4.

Audit of all DOCX report generators against **EQ Solutions Design Brief v1.3 (17 April 2026)**, plus the SKS Technologies brand notes in the global CLAUDE.md.

Brief source: `C:\Users\EQ\OneDrive - eq-power.com.au\Documents\EQ_Design_Brief_v1_3.docx`.

## TL;DR

The six DOCX generators were built at different times and **drift heavily** from the brief and from each other. There are three different fonts in use across the report family, no use of the canonical R2 logo URLs, four different greys masquerading as "EQ Mid Grey," and the SKS-tenant reports leak EQ-flavoured table colours into pages that should be SKS-flavoured. None of this is broken — it's a polish-and-consistency problem — but it's exactly the kind of thing a customer at Equinix's level notices when comparing reports from competing contractors.

## What I checked

| Generator | File | Purpose |
|---|---|---|
| Compliance | [compliance-report.ts](lib/reports/compliance-report.ts) | Monthly meeting dashboard |
| ACB Test | [acb-report.ts](lib/reports/acb-report.ts) | Per-site air-circuit-breaker test results |
| NSX Test | [nsx-report.ts](lib/reports/nsx-report.ts) | Per-site MCCB / NSX test results |
| PM Check | [pm-check-report.ts](lib/reports/pm-check-report.ts) | Per-check task summary |
| PM Asset | [pm-asset-report.ts](lib/reports/pm-asset-report.ts) | Customer-facing per-asset PM report |
| Work Order Details | [work-order-details.ts](lib/reports/work-order-details.ts) | Per-asset Maximo-parity layout |
| Maintenance Checklist (Field Run-Sheet) | [maintenance-checklist.ts](lib/reports/maintenance-checklist.ts) | Printable field tick-sheet |
| Shared shell | [report-shell.ts](lib/reports/report-shell.ts) | Cover/header/footer/sign-off scaffolding |
| Shared branding | [report-branding.ts](lib/reports/report-branding.ts) | Logo fetching + masthead |

Plus the brief itself (§6.1 colour, §6.2 typography, §6.4 logo hosting, §7 constraints).

---

## Findings by severity

### 🔴 Showstoppers — visible in customer-facing artefacts

#### S1. Three different fonts across one report family

The brief (§6.2) is unambiguous: **Word documents use Aptos Display for headings + Aptos for body.** Reality:

| File | Font in use | Brief says |
|---|---|---|
| [compliance-report.ts:107](lib/reports/compliance-report.ts:107) | `Calibri` | Aptos Display / Aptos |
| [maintenance-checklist.ts:96](lib/reports/maintenance-checklist.ts:96) | `Arial` | Aptos Display / Aptos |
| [pm-asset-report.ts:157](lib/reports/pm-asset-report.ts:157) | `Arial` | Aptos Display / Aptos |
| [pm-check-report.ts](lib/reports/pm-check-report.ts) | `Plus Jakarta Sans` | Aptos Display / Aptos |
| [acb-report.ts](lib/reports/acb-report.ts) | `Plus Jakarta Sans` | Aptos Display / Aptos |
| [nsx-report.ts](lib/reports/nsx-report.ts) | `Plus Jakarta Sans` | Aptos Display / Aptos |
| [work-order-details.ts](lib/reports/work-order-details.ts) | `Plus Jakarta Sans` | Aptos Display / Aptos |
| [report-shell.ts](lib/reports/report-shell.ts) | `Plus Jakarta Sans` | Aptos Display / Aptos |

A customer who receives the Compliance Report (Calibri) and the ACB Report (Plus Jakarta Sans, which silently substitutes to Calibri on machines without it installed) sees two different-looking documents from the same vendor. **Plus Jakarta Sans is the *web* font** — using it in Word means most readers see the substitute (typically Calibri or Times New Roman) and the carefully-designed feel disappears. Aptos / Aptos Display ships with Microsoft 365 and is the safe default.

**Fix:** introduce a single `lib/reports/typography.ts` with two exported constants (`FONT_HEADING = 'Aptos Display'`, `FONT_BODY = 'Aptos'`), import everywhere, replace the hardcoded strings.

**Effort:** ~45 min find-and-replace + visual verification on one report per generator.

#### S2. EQ Ice Blue is hardcoded into table headers — leaks EQ branding into SKS reports

Every generator hardcodes `D5E8F0` (or close variants) as table header fill — see e.g. [pm-check-report.ts:88](lib/reports/pm-check-report.ts:88), [acb-report.ts:204](lib/reports/acb-report.ts:204), [nsx-report.ts:178](lib/reports/nsx-report.ts:178), [work-order-details.ts:154](lib/reports/work-order-details.ts:154).

`D5E8F0` is a slight variant of EQ Ice Blue (the brief specifies `#EAF5FB`). When the tenant is SKS (purple `#8070c0`), the body of the report tries to use the tenant's colour but **table headers stay EQ-blue**. A customer reading an SKS report sees alternating SKS-purple and EQ-blue surfaces — incoherent.

**Fix:** derive the table header fill from the tenant's primary colour at the call site (e.g. lighten the brand colour by 80% via the `mixWithWhite` helper already in [pm-check.ts](lib/reports/html/pm-check.ts)). For an SKS report, table headers become a soft purple; for an EQ-product report, they remain EQ Ice Blue.

**Effort:** ~30 min — extract the helper, thread the brand colour through the existing `headerCell()` functions.

#### S3. EQ Mid Grey is four different greys

Brief §6.1 specifies `#666666` for EQ Mid Grey (secondary text/labels/metadata). Reality:

- `#666666` — used in compliance, nsx, work-order, acb (correct)
- `#999999` — used in pm-check, nsx, compliance, report-branding (wrong, too light)
- `#6B7280` — used in acb, pm-asset, [pm-check html template](lib/reports/html/pm-check.ts) (wrong, Tailwind grey-500)
- `#7F8C8D`, `#95A5A6`, `#34495E`, `#566573`, `#BDC3C7` — used in pm-asset (wrong, FlatUI palette)

**Fix:** introduce `lib/reports/colours.ts` exporting the brief's named tokens (`EQ_INK = '#1A1A2E'`, `EQ_MID_GREY = '#666666'`, etc), import everywhere, replace the literals.

**Effort:** ~30 min mechanical replace + spot-check, but high signal for visual consistency.

#### S4. PM Asset Report uses an unrelated FlatUI palette throughout

[pm-asset-report.ts](lib/reports/pm-asset-report.ts) uses `#2C3E50` (slate), `#7F8C8D` (asbestos), `#95A5A6` (concrete), `#27AE60` (emerald), `#F39C12` (orange), `#E74C3C` (alizarin), `#C0392B` (pomegranate). These are FlatUI default colours — popular ~2014 web aesthetic — not EQ brand colours. None appear in the brief.

This is the report **currently rendered as customer-facing** (per the SY3 file you generated today). It has the most exposure and the most brand drift.

**Fix:** replace the FlatUI palette with EQ tokens (or tenant-derived equivalents). Status colours (pass/fail/warning) should map to the brief's tokens — there's no green or red defined yet, so we either:
(a) introduce semantic tokens (`SEMANTIC_PASS`, `SEMANTIC_FAIL`, `SEMANTIC_WARN`) sourced from a small status palette and document them as an extension, or
(b) keep status colours but pin them to specific hex values (`#16a34a`, `#dc2626`, `#d97706`) defined once.

**Effort:** ~1 hour. This is the most invasive single fix and the one I'd ask you to eyeball before/after.

---

### 🟡 Quality — won't lose you a customer, but reads as unpolished

#### Q1. No use of canonical R2 logo URLs

Brief §6.4 + §7: EQ logo masters live at `https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_*.png`. Brief explicitly says **never use Supabase for static assets** and **never rely on local files inside Claude sessions**.

The codebase nowhere references `r2.dev`, `cloudflare`, or `EQ_logo`. Logos come from:
- Tenant `report_logo_url` (Supabase storage) — fine for SKS-tenant logos (these are tenant-controlled assets, the rule doesn't apply)
- Tenant `logo_url` fallback (Supabase storage) — fine for the same reason
- No EQ-branded fallback anywhere — when a tenant has no logo configured, the report has no logo at all

**Fix:** add an EQ-product fallback path (`lib/reports/eq-fallback.ts`) that returns the R2 URL `EQ_logo_blue_transparent@2x.png` for the body and `EQ_logo_white_transparent@2x.png` for the dark cover band, used only when the tenant has neither `report_logo_url` nor `logo_url` configured. Tenant-uploaded logos still take priority.

**Effort:** ~20 min.

#### Q2. Logo dimensions inconsistent between reports

`fetchLogoImage` is called with different `maxWidth/maxHeight` in different places:
- [report-shell.ts:182-187](lib/reports/report-shell.ts:182): customer logo `220×80`, tenant logo `220×80`, on-dark `280×100`, site photo `600×300`
- [report-branding.ts:50-51](lib/reports/report-branding.ts:50): defaults `180×60`
- [generate-and-store.ts:137](lib/reports/generate-and-store.ts:137): `180×60`

Brief §7: "Minimum logo size: 24px in digital contexts. Clear space around logo: equal to logo height."

Different reports show the SKS logo at noticeably different sizes. The clear-space rule (= logo height of padding around it) is honoured by no generator.

**Fix:** centralise the constants in `lib/reports/sizing.ts`. Apply the clear-space rule via paragraph spacing equal to the logo's natural height.

**Effort:** ~30 min.

#### Q3. Maintenance Checklist (Field Run-Sheet) has no brand colour at all

[maintenance-checklist.ts:99-103](lib/reports/maintenance-checklist.ts:99): borders are pure black (`#000000`), font is Arial, headings have no colour. The intent is "printer-friendly black-and-white" (per its own doc comment), but the result is **utterly anonymous** — there's nothing distinguishing an SKS field run-sheet from one a competitor printed.

**Fix:** add a top-of-page brand strip (1cm height, tenant primary colour) with the SKS logo on the left and "Field Run-Sheet" right-aligned. Keep the body B&W for tick-friendly ink saving. Even one branded band makes the document recognisably SKS without compromising printability.

**Effort:** ~20 min.

#### Q4. Compliance Report uses solid-fill table headers in *only* white text

[compliance-report.ts:107](lib/reports/compliance-report.ts:107): `headerCell` paints the whole header cell in the brand colour with white text. That's fine for short labels but causes WCAG contrast issues if the brand colour is light (e.g. SKS purple `#8070c0` on white text is borderline). Brief §6.7 requires WCAG 2.1 AA and lists EQ Sky Blue as "headlines 18pt+ and UI components only — never body text" — table headers are body-grade text.

**Fix:** switch the compliance header from "brand fill + white text" to "ice fill + ink text" — matches §6.7 (EQ Ink on EQ Ice Blue: 16.2:1 contrast, passes for all sizes) and aligns with the other generators.

**Effort:** ~10 min.

---

### 🟢 Nice-to-have — consistency for future-proofing

#### N1. Border colour drift

Borders use `#CCCCCC`, `#D5D8DC`, `#000000` across files. Brief doesn't define a border token explicitly but the brand's "Linear / Notion" aesthetic and §6.6 (no shadows, no gradients) implies minimal `#E5E7EB`-ish hairlines. Pick one, name it `EQ_BORDER`, use it.

#### N2. Hardcoded brand fallback `#3DA8D8` is correct but inconsistent

When a tenant has no primary colour configured, the code defaults to `#3DA8D8` (correct — that's EQ Sky Blue). But the fallback path lives in different files: [generate-and-store.ts:88](lib/reports/generate-and-store.ts:88), [report-shell.ts:132](lib/reports/report-shell.ts:132), [pm-check html](lib/reports/html/pm-check.ts), etc. Centralise it in `lib/reports/colours.ts`.

#### N3. The `as any` cast on BORDER_NONE

[maintenance-checklist.ts:102](lib/reports/maintenance-checklist.ts:102) and [pm-asset-report.ts:163](lib/reports/pm-asset-report.ts:163) have:
```ts
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as any
```
This is a `docx` type quirk worked around with `any`. Probably fine but if the docx library tightens its types one day this breaks — pin it to the actual type.

---

## Recommended fix order

If you're going to invest in cleaning this up, the order that maximises customer-visible improvement per hour invested:

1. **S3 + N2 + N1: Centralise colours + borders.** Half a day. Ground-truth for everything else. (`lib/reports/colours.ts`.)
2. **S1: Centralise font.** 45 min. Massive consistency win, all reports look like they came from the same vendor.
3. **S4: PM Asset Report colour cleanup.** 1 hr. Highest customer-exposure report, biggest brand drift.
4. **S2: Tenant-aware table headers.** 30 min. Removes the EQ-blue-leak when SKS is the tenant.
5. **Q4: Compliance Report contrast fix.** 10 min. Cheap fix, clears a WCAG concern.
6. **Q3: Field Run-Sheet brand strip.** 20 min. Field documents currently look generic; small change makes them SKS-recognisable.
7. **Q1: R2 fallback path.** 20 min. Belts-and-braces — only fires when a tenant has no logo at all, which is rare, but stops the "no logo at all" failure mode.
8. **Q2: Logo sizing constants.** 30 min. Polish.

Total: ~5 hours of focused work to bring the entire report family up to brief.

## What I'm NOT doing tonight

- Applying any of these fixes. All of them are visual changes that affect customer-facing artefacts. You should eyeball at least one report per generator before/after, and that requires you awake.
- Touching `pm-asset-report.ts` colour palette. It's the highest-risk single change because the report is in active customer use.
- Adding the R2 fallback. Decision needed first — do you want EQ branding to ever appear on an SKS report when SKS hasn't set a logo? Probably not — better to fail visibly so SKS notices and uploads their logo.

## Open question for you

Brief §6.1 doesn't define semantic colours (pass green, fail red, warning amber). The reports use them everywhere — they have to. The choice is:

- **Option A:** Document them as an extension (`#16a34a` pass, `#dc2626` fail, `#d97706` warn) and add to the brief in v1.4.
- **Option B:** Use status icons + brand-only colours, no green/red (e.g. ✓/✗/— in EQ Ink with bold weight only). Cleaner but less scannable.

I'd vote A — the medical-record / industrial-control sector expects green/red status semantics. Worth raising next time you touch the brief.
