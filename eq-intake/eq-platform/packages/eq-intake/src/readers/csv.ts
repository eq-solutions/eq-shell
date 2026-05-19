/**
 * CSV reader.
 *
 * Turns a CSV file (Buffer, Uint8Array, or string) into:
 *   { headerRow, rows, meta }
 *
 * rows are Record<string, unknown>[] — keyed by header column name, values as
 * raw strings. The downstream @eq/validation coercers handle typing.
 *
 * Behaviour:
 *   - Accepts Buffer / Uint8Array / string. Buffer/Uint8Array decoded as UTF-8.
 *   - Strips UTF-8 BOM (0xEF 0xBB 0xBF) if present.
 *   - Auto-detects delimiter via Papa Parse (comma / semicolon / tab / pipe).
 *     Override with opts.delimiter if known.
 *   - Trims whitespace from header names.
 *   - Skips fully-empty rows.
 *   - dynamicTyping is OFF — every cell comes back as a string so coercers
 *     get unambiguous input.
 *
 * Out of scope for v1 (defer until real files force it):
 *   - Non-UTF-8 encoding auto-detection (Windows-1252, Latin-1).
 *     If you know the encoding, pass opts.encoding.
 *   - Header-row detection when the header isn't on line 1 (title rows,
 *     blank rows before the data). v1 assumes row 1 is the header.
 *   - Streaming for very large files. v1 reads the whole string into memory.
 */

import Papa from "papaparse";

export type CsvRow = Record<string, unknown>;

export interface ParsedSheet {
  /** Logical sheet name. CSV files always have one sheet; default 'csv'. */
  sheetName: string;
  /** Column headers in source order, with whitespace trimmed. */
  headerRow: string[];
  /** Data rows keyed by header column name. */
  rows: CsvRow[];
  /** Parse diagnostics — useful for the confirm UI and audit trail. */
  meta: ParseMeta;
}

export interface MalformedRow {
  /** 1-based source line number (data lines after the header are 2, 3, ...). */
  lineNumber: number;
  /** Raw source line text, untouched. */
  raw: string;
  /** Short machine-readable code, e.g. "extra_fields", "missing_fields", "quote_mismatch". */
  reason: string;
  /** Human-readable detail Papa Parse produced. */
  message: string;
}

export interface ParseMeta {
  /** Encoding used to decode the input. */
  encoding: string;
  /** Delimiter Papa Parse detected (or the override the caller passed). */
  delimiter: string;
  /** Number of data rows returned in `rows`. */
  totalRows: number;
  /** Rows in the source that were skipped because they were fully empty. */
  emptyRowsSkipped: number;
  /** Number of malformed rows excluded from `rows` (same as `malformed.length`). */
  malformedRows: number;
  /** Per-row diagnostics for malformed lines that didn't make it into `rows`.
   *  Surfaced so the confirm UI can show "these rows didn't parse" with line
   *  numbers and reasons — drops are visible, not silent. */
  malformed: MalformedRow[];
  /** True if a UTF-8 BOM was detected and stripped from the input. */
  bomDetected: boolean;
}

export interface ParseCsvOptions {
  /** Text encoding to use when decoding Buffer/Uint8Array input. Default 'utf-8'. */
  encoding?: string;
  /** Force a specific delimiter. Default: auto-detect via Papa Parse. */
  delimiter?: string;
  /** Skip rows where every cell is empty. Default true. */
  skipEmptyLines?: boolean;
  /** Logical name to record in the result. Default 'csv'. */
  sheetName?: string;
}

const UTF8_BOM = "﻿";

/**
 * Parse a CSV input into a ParsedSheet.
 */
export async function parseCsv(
  input: Buffer | Uint8Array | string,
  opts: ParseCsvOptions = {},
): Promise<ParsedSheet> {
  const encoding = opts.encoding ?? "utf-8";

  // 1. Decode to string
  let text: string;
  let bomDetected = false;

  if (typeof input === "string") {
    text = input;
  } else {
    // Buffer extends Uint8Array, so this branch covers both.
    const bytes =
      input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBufferLike);

    // Detect UTF-8 BOM in the raw bytes so we can report it
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      bomDetected = true;
      text = new TextDecoder(encoding).decode(bytes.subarray(3));
    } else {
      text = new TextDecoder(encoding).decode(bytes);
    }
  }

  // 2. Strip BOM if it survived as a U+FEFF code unit at position 0
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(UTF8_BOM.length);
    bomDetected = true;
  }

  // 3. Parse
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    delimiter: opts.delimiter ?? "", // empty string => Papa auto-detects
    skipEmptyLines: opts.skipEmptyLines ?? true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  const headerRow = (result.meta.fields ?? []).map((f) => f.trim());
  const rawRows = result.data;
  const sourceLines = text.split(/\r?\n/);

  // Build the set of malformed source-row indices (0-based, where 0 = first
  // data row, NOT counting the header). Papa Parse reports field count
  // mismatches as FieldMismatch errors with .row, and it also leaves a
  // `__parsed_extra` array on rows that had more columns than headers — these
  // are silent corruption (downstream code reads by header name and misses
  // the overflow). Treat both as malformed and exclude from `rows`.
  const malformedRowIndices = new Set<number>();
  const malformedFromErrors: MalformedRow[] = [];
  for (const e of result.errors) {
    if (e.type !== "FieldMismatch" && e.type !== "Quotes") continue;
    if (typeof e.row !== "number") continue;
    malformedRowIndices.add(e.row);
    const lineNumber = e.row + 2; // +1 for 0-based, +1 for header
    const reason = e.type === "FieldMismatch"
      ? (e.code === "TooManyFields" ? "extra_fields" : "missing_fields")
      : "quote_mismatch";
    malformedFromErrors.push({
      lineNumber,
      raw: sourceLines[lineNumber - 1] ?? "",
      reason,
      message: e.message,
    });
  }

  // Also catch any row Papa accepted but stuffed with __parsed_extra — these
  // would otherwise look valid to downstream code reading by header name.
  const malformed: MalformedRow[] = [...malformedFromErrors];
  rawRows.forEach((row, idx) => {
    if (malformedRowIndices.has(idx)) return; // already accounted for
    if (Object.prototype.hasOwnProperty.call(row, "__parsed_extra")) {
      malformedRowIndices.add(idx);
      const lineNumber = idx + 2;
      malformed.push({
        lineNumber,
        raw: sourceLines[lineNumber - 1] ?? "",
        reason: "extra_fields",
        message: "Row had more columns than the header — overflow in __parsed_extra.",
      });
    }
  });

  // Filter malformed rows out of the returned rows so downstream code only
  // sees clean rows. The malformed ones are surfaced via meta.malformed[].
  const rows = rawRows
    .filter((_, idx) => !malformedRowIndices.has(idx))
    .map((row) => {
      // Defensive: strip __parsed_extra if any survived (shouldn't, but cheap).
      if (Object.prototype.hasOwnProperty.call(row, "__parsed_extra")) {
        const clean = { ...row };
        delete (clean as Record<string, unknown>).__parsed_extra;
        return clean;
      }
      return row;
    });

  // Empty-row count: derive from non-empty source lines minus header, rows
  // accepted, and rows rejected as malformed.
  let emptyRowsSkipped = 0;
  if (opts.skipEmptyLines ?? true) {
    const nonEmptyLines = sourceLines.filter((l) => l.trim().length > 0).length;
    emptyRowsSkipped = Math.max(0, nonEmptyLines - 1 - rows.length - malformed.length);
  }

  return {
    sheetName: opts.sheetName ?? "csv",
    headerRow,
    rows,
    meta: {
      encoding,
      delimiter: result.meta.delimiter ?? opts.delimiter ?? ",",
      totalRows: rows.length,
      emptyRowsSkipped,
      malformedRows: malformed.length,
      malformed,
      bomDetected,
    },
  };
}
