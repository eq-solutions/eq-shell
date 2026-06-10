/**
 * reconcile — diff a source sheet against canonical rows.
 *
 * Given a ParsedSheet (just parsed from a dropped file) and a list of
 * canonical rows already in the database, this module:
 *   1. Finds the best match key (email, staff_id, serial_number, …)
 *   2. Matches source rows ↔ canonical rows on that key
 *   3. For matched pairs, flags field-level conflicts (same key, different value)
 *   4. Returns four buckets:
 *      - matched      — source row == canonical row on all non-key fields (green)
 *      - conflicts    — source row differs from canonical on ≥1 field (orange)
 *      - onlyInSource — source row has no canonical counterpart (red / new)
 *      - onlyInCanonical — canonical row not in source (grey / untouched)
 *
 * Resolution is tracked per-row via the `resolution` field. The commit step
 * (in ReconcileModule) uses it to decide which rows to write.
 */

import type { ParsedSheet } from "./readers/csv.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single field-level conflict between source and canonical. */
export interface FieldConflict {
  /** Canonical field name. */
  field: string;
  /** Value from the dropped file. May be empty string. */
  sourceValue: string;
  /** Value from the canonical database row. May be empty string. */
  canonicalValue: string;
}

/** The user's choice for how to resolve a conflicting row. */
export type Resolution = "keep-canonical" | "use-source" | "skip";

/** One row in the reconciliation output. */
export interface ReconcileRow {
  /** The original source row (from the parsed file). undefined for onlyInCanonical. */
  sourceRow?: Record<string, unknown>;
  /** The canonical row from the database. undefined for onlyInSource. */
  canonicalRow?: Record<string, unknown>;
  /** Field-level diffs. Empty for matched or onlyIn* rows. */
  conflicts: FieldConflict[];
  /** User-selected resolution for conflict rows. */
  resolution?: Resolution;
}

/** Full output of reconcileSheets(). */
export interface ReconcileResult {
  /** Source rows that match canonical exactly — no action needed. */
  matched: ReconcileRow[];
  /** Source rows that match on key but differ on ≥1 field — needs user review. */
  conflicts: ReconcileRow[];
  /** Source rows with no canonical counterpart — will be added on commit. */
  onlyInSource: ReconcileRow[];
  /** Canonical rows not present in source — will be left untouched. */
  onlyInCanonical: ReconcileRow[];
  /** The field name used as the match key. */
  matchKey: string;
}

// ---------------------------------------------------------------------------
// Match-key detection
// ---------------------------------------------------------------------------

/**
 * Priority-ordered list of field names that are likely unique identifiers.
 * When the source sheet contains one of these columns (exact or
 * case-insensitive match), we use it as the join key.
 */
const PREFERRED_KEYS: string[] = [
  "email",
  "email_address",
  "staff_id",
  "employee_id",
  "asset_serial_number",
  "serial_number",
  "serial_no",
  "external_id",
  "abn",
  "customer_id",
  "site_id",
  "contact_id",
  "phone",
  "mobile",
  "id",
];

/**
 * Detect the best match key for a given source sheet.
 * Returns the first column name (from the sheet's headerRow) that matches
 * any of the PREFERRED_KEYS (case-insensitive). Falls back to the first
 * column if none match.
 */
export function detectMatchKey(sheet: ParsedSheet): string {
  const lower = sheet.headerRow.map((h) => h.toLowerCase().replace(/[\s_-]+/g, "_"));

  for (const preferred of PREFERRED_KEYS) {
    const idx = lower.indexOf(preferred);
    if (idx !== -1) return sheet.headerRow[idx]!;
  }

  // Partial match — "email" inside a longer column name
  for (const preferred of PREFERRED_KEYS) {
    const idx = lower.findIndex((h) => h.includes(preferred));
    if (idx !== -1) return sheet.headerRow[idx]!;
  }

  return sheet.headerRow[0] ?? "id";
}

// ---------------------------------------------------------------------------
// Core reconcile function
// ---------------------------------------------------------------------------

/**
 * Reconcile a parsed source sheet against canonical rows.
 *
 * @param sourceSheet   The ParsedSheet from the dropped file.
 * @param canonicalRows The existing rows fetched from the canonical database.
 * @param matchKey      The field to join on. Auto-detected if not supplied.
 */
export function reconcileSheets(
  sourceSheet: ParsedSheet,
  canonicalRows: Record<string, unknown>[],
  matchKey?: string,
): ReconcileResult {
  const key = matchKey ?? detectMatchKey(sourceSheet);

  // Build a map of canonical rows keyed by matchKey value for O(1) lookup.
  const canonicalByKey = new Map<string, Record<string, unknown>>();
  for (const row of canonicalRows) {
    const keyValue = normaliseValue(row[key]);
    if (keyValue !== "") {
      canonicalByKey.set(keyValue, row);
    }
  }

  // Track which canonical keys we matched (so we can detect onlyInCanonical).
  const matchedCanonicalKeys = new Set<string>();

  const matched: ReconcileRow[] = [];
  const conflicts: ReconcileRow[] = [];
  const onlyInSource: ReconcileRow[] = [];

  for (const sourceRow of sourceSheet.rows as Record<string, unknown>[]) {
    const keyValue = normaliseValue(sourceRow[key]);

    if (keyValue === "") {
      // No key value — treat as onlyInSource (can't match without a key).
      onlyInSource.push({ sourceRow, conflicts: [] });
      continue;
    }

    const canonicalRow = canonicalByKey.get(keyValue);

    if (!canonicalRow) {
      onlyInSource.push({ sourceRow, conflicts: [] });
      continue;
    }

    matchedCanonicalKeys.add(keyValue);

    // Compare field-by-field for columns present in both source and canonical.
    const fieldConflicts = detectFieldConflicts(sourceRow, canonicalRow);

    if (fieldConflicts.length === 0) {
      matched.push({ sourceRow, canonicalRow, conflicts: [] });
    } else {
      conflicts.push({ sourceRow, canonicalRow, conflicts: fieldConflicts });
    }
  }

  // Collect canonical rows that had no matching source row.
  const onlyInCanonical: ReconcileRow[] = [];
  for (const [keyValue, canonicalRow] of canonicalByKey) {
    if (!matchedCanonicalKeys.has(keyValue)) {
      onlyInCanonical.push({ canonicalRow, conflicts: [] });
    }
  }

  return { matched, conflicts, onlyInSource, onlyInCanonical, matchKey: key };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a cell value to a lowercase trimmed string for comparison. */
function normaliseValue(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

/**
 * Compare every field in sourceRow against canonicalRow.
 * Only reports conflicts for fields that appear in BOTH rows and have
 * non-empty values that differ after normalisation.
 */
function detectFieldConflicts(
  sourceRow: Record<string, unknown>,
  canonicalRow: Record<string, unknown>,
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];

  // All fields in the source row that also appear in canonical.
  for (const field of Object.keys(sourceRow)) {
    if (!(field in canonicalRow)) continue;

    const sourceValue = normaliseValue(sourceRow[field]);
    const canonicalValue = normaliseValue(canonicalRow[field]);

    // Skip if either side is empty (we don't treat empty as "different").
    if (sourceValue === "" || canonicalValue === "") continue;

    if (sourceValue !== canonicalValue) {
      conflicts.push({
        field,
        sourceValue: String(sourceRow[field] ?? ""),
        canonicalValue: String(canonicalRow[field] ?? ""),
      });
    }
  }

  return conflicts;
}
