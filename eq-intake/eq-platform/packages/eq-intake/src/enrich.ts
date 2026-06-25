/**
 * Asset enrichment orchestrator.
 *
 * Given already-validated canonical rows, ask the AI provider to infer the
 * maintenance fields a SimPRO export usually omits (asset_type, criticality,
 * ppm_frequency) from the name/make/model each row already carries.
 *
 * This NEVER writes a value. It returns per-row suggestions; the confirm UI
 * surfaces them as accept/reject so the bookkeeper stays in control. A row is
 * only sent to the model when (a) it's missing at least one requested field
 * and (b) it has at least one evidence field to infer from — otherwise there's
 * nothing to suggest and no point spending a token on it.
 *
 * Returned suggestions are filtered to the fields each row was actually
 * missing, so an inference for a field the source already filled is dropped
 * rather than offered as a pointless "change this".
 */

import type { AIProvider, EnrichRowSuggestion } from "@eq/ai";

export interface EnrichAssetsRow {
  /** Source row index — preserved through the suggestion so the caller can match. */
  index: number;
  /** The validated canonical row. */
  canonical: Record<string, unknown>;
}

export interface EnrichAssetsOptions {
  /** AI provider. If it has no enrich() capability, this is a no-op (returns []). */
  ai: AIProvider;
  /** Canonical JSON Schema (supplies allowed enum / suggested values to the model). */
  schema: Record<string, unknown>;
  /** Rows to consider for enrichment. */
  rows: EnrichAssetsRow[];
  /** Canonical fields to infer when missing. */
  fieldsToInfer: string[];
  /**
   * Fields used as evidence for inference. Default: name, make, model.
   * A row with none of these present is skipped — nothing to infer from.
   */
  evidenceFields?: string[];
}

const DEFAULT_EVIDENCE = ["name", "make", "model"];

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Returns per-row field suggestions for the rows that needed enrichment.
 * Empty array when the provider can't enrich or nothing needed it.
 */
export async function enrichAssets(
  opts: EnrichAssetsOptions,
): Promise<EnrichRowSuggestion[]> {
  if (!opts.ai.enrich) return [];

  const evidenceFields = opts.evidenceFields ?? DEFAULT_EVIDENCE;

  // Per row, the subset of requested fields that are actually missing. Only
  // these are eligible to be surfaced even if the model returns more.
  const missingByIndex = new Map<number, Set<string>>();
  const toEnrich: { index: number; fields: Record<string, unknown> }[] = [];

  for (const row of opts.rows) {
    const missing = opts.fieldsToInfer.filter((f) => isMissing(row.canonical[f]));
    if (missing.length === 0) continue;

    const evidence: Record<string, unknown> = {};
    for (const f of evidenceFields) {
      if (!isMissing(row.canonical[f])) evidence[f] = row.canonical[f];
    }
    if (Object.keys(evidence).length === 0) continue;

    missingByIndex.set(row.index, new Set(missing));
    toEnrich.push({ index: row.index, fields: evidence });
  }

  if (toEnrich.length === 0) return [];

  const result = await opts.ai.enrich({
    targetSchema: opts.schema,
    rows: toEnrich,
    fieldsToInfer: opts.fieldsToInfer,
  });

  // Keep only suggestions for fields the row was missing; drop empty rows.
  const filtered: EnrichRowSuggestion[] = [];
  for (const sug of result.suggestions) {
    const missing = missingByIndex.get(sug.index);
    if (!missing) continue;
    const fields = Object.fromEntries(
      Object.entries(sug.fields).filter(([field]) => missing.has(field)),
    );
    if (Object.keys(fields).length === 0) continue;
    filtered.push({ index: sug.index, fields });
  }
  return filtered;
}
