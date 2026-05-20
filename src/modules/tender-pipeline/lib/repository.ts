// TenderRepository — data-plane abstraction for the Tender Pipeline.
//
// The shell needs to read/write per-tenant pipeline data (today, that's
// the `tenders`, `tender_import_runs`, `nominations`, `tender_enrichment`,
// and `pending_schedule` tables on the EQ-tenant Supabase
// `ktmjmdzqrogauaevbktn`). But the shell's auth/canonical data lives
// on `eq-shell-control` (`hxwitoveffxhcgjvubbd`), a different project.
//
// How the shell talks to the per-tenant Supabase is an open
// architectural decision (Phase 2 design): anon-key client with RLS
// gating, vs. a Netlify function proxy with service-role + session
// token, vs. something else. That decision is deferred.
//
// To unblock building the Import surface, every page in the module
// takes a `TenderRepository` from context. The Import PR ships a
// `MockTenderRepository` for development; the real implementation
// lands when the data-plane design is locked.

import type { ExistingTender, ImportDiff, ImportSummary, TenderRow } from './tenderParser';

export interface ImportRun {
  imported_at: string;
  file_name: string;
  rows_total: number;
  rows_new: number;
  rows_stage_changed: number;
  rows_value_changed: number;
  rows_missing: number;
  rows_below_threshold: number;
  notes: string | null;
}

export interface ApplyImportInput {
  diff: ImportDiff;
  summary: ImportSummary;
  fileName: string;
  parsedRows: TenderRow[];
}

export interface TenderRepository {
  // Reads
  getCurrentTenders(): Promise<ExistingTender[]>;
  getLastImportRun(): Promise<ImportRun | null>;

  // Writes — applies the full import diff atomically (per the vanilla
  // _applyImport flow: INSERT new, PATCH stage+value changes,
  // bump missing, INSERT tender_import_runs row).
  applyImport(input: ApplyImportInput): Promise<void>;
}
