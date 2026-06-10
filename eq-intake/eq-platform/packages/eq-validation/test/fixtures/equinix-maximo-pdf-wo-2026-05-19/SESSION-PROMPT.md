# Session prompt — build the `maximo-pdf-wo` Intake skill

Copy/paste the section below as your opening message to a fresh Claude Code session in the `C:/Projects/eq-intake` repo. Self-contained — the future agent has no memory of the conversation that prepared this fixture.

---

## Prompt

I want you to build a new EQ Intake skill called `maximo-pdf-wo` that ingests IBM Maximo work-order PDFs (Equinix's preferred handoff for ad-hoc / mid-cycle WO additions outside the monthly Delta xlsx).

### Why this exists

EQ Service today imports Equinix work orders from a monthly Delta xlsx export — that works. But Equinix also emails ad-hoc PDFs for extra WOs that come up between monthly cycles (typical scenario: customer asks for additional work at handover; site engineer scans the printed WO and emails it across).

Right now those PDFs are 100% manual entry in eq-service — open `/maintenance/new`, retype site / plan / assets / dates, attach the PDF as evidence. The eq-service team is not going to bolt a PDF parser onto eq-service. PDFs are EQ Intake's job — that's the canonical-layer-as-spine pattern we locked in 2026-05-19.

### What's already prepared for you

In this directory (`C:/Projects/eq-intake/eq-platform/packages/eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/`):

- **4 real customer PDFs** from Danny O'Toole (Equinix AU) sent 2026-05-19. Three are office-scanned (each carries 2 stapled WOs; OCR path) and one is a clean Maximo print (single WO; text-extractable path).
- **`README.md`** — provenance + a full table mapping every WO# to asset, site, job plan, target date, and which PDF it came from. 7 WOs total across 4 PDFs.
- **`SKILL-BRIEF.md`** — the field-by-field extraction guide. Maps each PDF header label to the canonical schema target (`maintenance_check.schema.json` or `check_asset.schema.json`). Covers the grouping rule (site + plan + target_start tuple → one maintenance_check). Lists test expectations.

Read both before you write code. They were written to make this a cold-start-friendly task.

### Architectural context (don't violate)

EQ Intake is the parsing brain. It receives messy inputs and emits canonical rows shaped against the schemas in `C:/Projects/eq-intake/schemas/`. EQ Service (and the other apps) consume the canonical bundle.

This means:
- The skill **does NOT need new canonical schemas**. The existing `maintenance_check.schema.json` and `check_asset.schema.json` already model the output shape. Just build the parser.
- The skill **does NOT belong in eq-service**. Don't propose adding PDF parsing there.
- The skill **should round-trip** — when given the same WOs as the existing eq-service Delta xlsx importer, the canonical output should be identical row-by-row. See `lib/import/delta-wo-parser.ts` and `lib/import/delta-row-mapping.ts` in eq-solves-service for the reference behaviour.

Global context in `~/.claude/CLAUDE.md` section "EQ Suite — current state & data flow" describes the broader architecture. Read it if you're not already up to speed.

### Scope

**Build:**
1. The `maximo-pdf-wo` skill itself — input detection (text vs OCR), field extraction, canonical-row emission.
2. Unit tests under `eq-platform/packages/eq-validation/test/` that consume the 4 fixture PDFs and assert canonical output.
3. A short README addition or skills index entry so the skill is discoverable.

**Do NOT:**
- Wire the skill into eq-service. That's a separate integration step, not part of this session.
- Touch any other untracked files in eq-intake (other agents have in-flight work).
- Modify the canonical schemas under `C:/Projects/eq-intake/schemas/` unless a real gap is discovered (and even then, propose first).
- Push or deploy anything without Royce's explicit instruction.

### Acceptance criteria

When you're done:
- All 4 fixture PDFs parse without error.
- The 7 WOs map to 2 `maintenance_check` rows (6 ATS WOs at AU01-CA1 for 20-May, plus 1 CUFT WO at AU01-CA1 for 20-Jun) and 7 `check_asset` rows, matching the table in `README.md`.
- Tests pass with `pnpm -r test` (or equivalent) — the existing test runner pattern.
- Idempotent re-parse on the same fixture set produces zero diffs.
- A two-paragraph summary in chat describing what shipped, what's tested, and any follow-up work the integration with eq-service will need.

### Working notes

- The OCR path is the harder of the two. Look at `eq-platform/packages/eq-ai/` for existing AI/vision integrations; reuse rather than reinvent.
- The clean-print PDF (`CUFT Work Order.pdf`) is your fastest win — text-extractable, single WO. Build that path first, then layer in OCR for the scanned files.
- Job plan code mapping: PDFs say `ATS-3 - E1.8 ATS-Automatic Transfer Switches`. The eq-service canonical plan code is `E1.8` (the bit after the dash). Match against `maintenance_plan.code` / `maintenance_plan.name` with fuzzy fallback.
- Site code: strip `AU0x-` prefix — `AU01-CA1` becomes `CA1` to match `site.code` in EQ Service. See `stripSitePrefix()` in eq-solves-service `lib/import/delta-wo-parser.ts`.

Start by reading `SKILL-BRIEF.md` in this directory. Everything you need to extract is enumerated there.
