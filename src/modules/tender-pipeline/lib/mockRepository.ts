// MockTenderRepository — in-memory implementation for development.
//
// Seed with a small fixture so the Import preview shows realistic
// new/stage-changed/value-changed/missing rows on first upload.
// Persists writes to its own internal state for the session — no
// localStorage / no network. Replace with a real implementation
// once the data-plane design is locked.

import type { ApplyImportInput, ImportRun, TenderRepository } from './repository';
import type { ExistingTender } from './tenderParser';

const SEED_TENDERS: ExistingTender[] = [
  { external_ref: 'SKS-16401', probability_pct: 70,  quote_value: 250_000, stage: 'likely',  job_name: 'AWS Sydney Region 3 — Switchroom A' },
  { external_ref: 'SKS-16402', probability_pct: 50,  quote_value: 180_000, stage: 'watch',   job_name: 'Equinix SY4 — Tier 1 Data Hall' },
  { external_ref: 'SKS-16403', probability_pct: 25,  quote_value: 90_000,  stage: 'tracked', job_name: 'AirTrunk SYD2 — UPS rooms' },
  { external_ref: 'SKS-16404', probability_pct: 100, quote_value: 410_000, stage: 'won',     job_name: 'NEXTDC S3 — Phase 2 fitout' },
  { external_ref: 'SKS-16405', probability_pct: 0,   quote_value: 60_000,  stage: 'tracked', job_name: 'Hospital — Westmead refurb' },
];

const SEED_LAST_RUN: ImportRun = {
  imported_at: '2026-05-12T03:24:00.000Z',
  file_name: 'Open 12m Tenders (State) 2026-05-12.xlsx',
  rows_total: 312,
  rows_new: 8,
  rows_stage_changed: 14,
  rows_value_changed: 6,
  rows_missing: 2,
  rows_below_threshold: 47,
  notes: null,
};

export class MockTenderRepository implements TenderRepository {
  private tenders: ExistingTender[];
  private lastRun: ImportRun | null;

  constructor(opts: { seed?: boolean } = { seed: true }) {
    this.tenders = opts.seed === false ? [] : [...SEED_TENDERS];
    this.lastRun = opts.seed === false ? null : { ...SEED_LAST_RUN };
  }

  async getCurrentTenders(): Promise<ExistingTender[]> {
    return [...this.tenders];
  }

  async getLastImportRun(): Promise<ImportRun | null> {
    return this.lastRun ? { ...this.lastRun } : null;
  }

  async applyImport(input: ApplyImportInput): Promise<void> {
    const { diff, summary, fileName } = input;

    // 1. INSERT new
    diff.new.forEach((row) => {
      this.tenders.push({
        external_ref:    row.external_ref,
        probability_pct: row.probability_pct,
        quote_value:     row.quote_value,
        stage:           row.stage,
        job_name:        row.job_name,
      });
    });

    // 2. PATCH stage+value changes (deduped — stageChanged rows already
    // cover any valueChanged dup, per vanilla _applyImport).
    const stageRefs = new Set(diff.stageChanged.map((r) => r.external_ref));
    const changedRows = [
      ...diff.stageChanged,
      ...diff.valueChanged.filter((r) => !stageRefs.has(r.external_ref)),
    ];
    changedRows.forEach((row) => {
      const idx = this.tenders.findIndex((t) => t.external_ref === row.external_ref);
      if (idx >= 0) {
        this.tenders[idx] = {
          ...this.tenders[idx],
          probability_pct: row.probability_pct,
          quote_value:     row.quote_value,
          stage:           row.stage,
        };
      }
    });

    // 3. Missing rows — vanilla bumps missing_import_count and
    // auto-archives at ≥2. The mock just drops them on second sight,
    // which is close enough for UI verification.
    // (Real implementation will mirror vanilla's bump-then-archive.)

    // 4. Record the import run.
    this.lastRun = {
      imported_at:          new Date().toISOString(),
      file_name:            fileName,
      rows_total:           summary.rows_total,
      rows_new:             summary.rows_new,
      rows_stage_changed:   summary.rows_stage_changed,
      rows_value_changed:   summary.rows_value_changed,
      rows_missing:         summary.rows_missing,
      rows_below_threshold: summary.rows_below_threshold,
      notes:                null,
    };
  }
}
