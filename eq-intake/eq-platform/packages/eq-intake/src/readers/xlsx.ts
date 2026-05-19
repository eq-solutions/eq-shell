/**
 * XLSX reader.
 *
 * Turns an XLSX file (Buffer / Uint8Array / ArrayBuffer) into one ParsedSheet
 * per worksheet. Each sheet's headers are auto-detected — real spreadsheets
 * often have a title row, blank row, then headers, so we walk down from row 0
 * to find the first row that looks like column headers.
 *
 * Each ParsedSheet has rows as Record<string, unknown>[] keyed by detected
 * header names — exactly the same shape as parseCsv() returns. Downstream
 * consumers (@eq/validation, the orchestrator, the confirm UI) don't need
 * to care whether the source was CSV or XLSX.
 *
 * Behaviour:
 *   - Reads .xlsx, .xls, and .xlsm. SheetJS handles the format detection.
 *   - One ParsedSheet returned per worksheet in workbook order.
 *   - Skips hidden sheets by default (override with includeHidden).
 *   - Header row auto-detected: first row with >= 2 non-empty cells where
 *     the next row also has data. Override with opts.headerRowIndex.
 *   - Excel date cells come back as ISO strings (cellDates: true), so
 *     coerceDate downstream sees a parseable input.
 *   - Numbers and booleans come through as their native JS types. The
 *     downstream coercers happily accept either.
 *   - Empty rows (every cell blank) are skipped.
 *
 * Out of scope for v1:
 *   - Merged-cell unwrapping. Merged cells in the header row will show as
 *     one populated cell and the rest empty — works fine for most exports.
 *   - Formula re-evaluation. Cells with formulas come through with their
 *     last-saved cached value, which is what every real consumer wants.
 *   - Streaming for huge files. v1 loads the whole workbook into memory.
 */

import * as XLSX from "xlsx";
import type { ParsedSheet, ParseMeta, CsvRow } from "./csv.js";

export interface ParsedWorkbook {
  /** One entry per worksheet (in workbook order). */
  sheets: ParsedXlsxSheet[];
  /** Top-level metadata about the file. */
  meta: WorkbookMeta;
}

export interface ParsedXlsxSheet extends ParsedSheet {
  /** 0-based index of the row used as the header. */
  headerRowIndex: number;
  /** True if this sheet was marked hidden in Excel. */
  hidden: boolean;
}

export interface WorkbookMeta {
  /** Count of sheets in the workbook (including hidden, before any filtering). */
  totalSheets: number;
  /** Count of sheets returned (after filtering). */
  returnedSheets: number;
  /** Format SheetJS detected. */
  format: string;
}

export interface ParseXlsxOptions {
  /**
   * If supplied, only this sheet is parsed. Useful when the caller already
   * knows which sheet of a multi-tab workbook is relevant.
   */
  sheetName?: string;
  /**
   * Force a specific header row (0-based). Default: auto-detect.
   */
  headerRowIndex?: number;
  /**
   * Include hidden sheets in the result. Default false.
   */
  includeHidden?: boolean;
  /**
   * Max number of rows to scan when auto-detecting the header. Default 20.
   * Real spreadsheets virtually never bury the header more than a few rows in.
   */
  headerScanLimit?: number;
}

/**
 * Parse an XLSX workbook into ParsedSheets.
 */
export async function parseXlsx(
  input: Buffer | Uint8Array | ArrayBuffer,
  opts: ParseXlsxOptions = {},
): Promise<ParsedWorkbook> {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBufferLike);

  const workbook = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });

  const totalSheets = workbook.SheetNames.length;
  const includeHidden = opts.includeHidden ?? false;
  const scanLimit = opts.headerScanLimit ?? 20;

  const targetNames = opts.sheetName
    ? workbook.SheetNames.filter((n) => n === opts.sheetName)
    : workbook.SheetNames;

  const sheets: ParsedXlsxSheet[] = [];

  for (const sheetName of targetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // SheetJS records hidden state in workbook.Workbook.Sheets[i].Hidden
    // (0 = visible, 1 = hidden, 2 = very hidden). Default visible.
    const sheetMeta = workbook.Workbook?.Sheets?.find?.((s) => s.name === sheetName);
    const hidden = (sheetMeta?.Hidden ?? 0) !== 0;
    if (hidden && !includeHidden) continue;

    // Pull all cells as a 2D array first so we can detect the header row.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: true,
      raw: true,
    });

    const headerRowIndex = opts.headerRowIndex ?? detectHeaderRow(aoa, scanLimit);

    const headerRaw = (aoa[headerRowIndex] ?? []) as unknown[];
    const headerRow = headerRaw.map((c, i) => normaliseHeader(c, i));

    const dataRows: CsvRow[] = [];
    let emptyRowsSkipped = 0;
    for (let r = headerRowIndex + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      if (rowIsEmpty(row)) {
        emptyRowsSkipped++;
        continue;
      }
      const obj: CsvRow = {};
      for (let c = 0; c < headerRow.length; c++) {
        const key = headerRow[c]!;
        const cell = row[c];
        obj[key] = normaliseCell(cell);
      }
      dataRows.push(obj);
    }

    const meta: ParseMeta = {
      encoding: "binary",
      delimiter: "xlsx",
      totalRows: dataRows.length,
      emptyRowsSkipped,
      malformedRows: 0,
      // xlsx reader doesn't currently produce per-row malformed diagnostics —
      // SheetJS shape doesn't error per cell the way Papa Parse does. Empty
      // array satisfies the shared ParseMeta contract added 2026-05-19; future
      // work can populate this for empty rows or type mismatches.
      malformed: [],
      bomDetected: false,
    };

    sheets.push({
      sheetName,
      headerRow,
      rows: dataRows,
      meta,
      headerRowIndex,
      hidden,
    });
  }

  return {
    sheets,
    meta: {
      totalSheets,
      returnedSheets: sheets.length,
      format: detectFormat(bytes),
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/** A row is empty if every cell is null, undefined, or whitespace-only string. */
function rowIsEmpty(row: unknown[]): boolean {
  for (const cell of row) {
    if (cell === null || cell === undefined) continue;
    if (typeof cell === "string" && cell.trim() === "") continue;
    return false;
  }
  return true;
}

/**
 * Auto-detect the header row. Heuristic:
 *   1. Skip leading empty rows.
 *   2. The first row with >= 2 non-empty cells, where the row below also has
 *      at least one non-empty cell, is the header.
 *   3. Tie-break: prefer rows that are mostly strings (typical of headers).
 *
 * Returns 0 if the heuristic finds nothing — the caller still gets a result,
 * it just uses row 0 as headers (which is usually correct for clean files).
 */
function detectHeaderRow(aoa: unknown[][], scanLimit: number): number {
  const limit = Math.min(aoa.length, scanLimit);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i] ?? [];
    const nonEmpty = row.filter(
      (c) => c !== null && c !== undefined && !(typeof c === "string" && c.trim() === ""),
    );
    if (nonEmpty.length < 2) continue;

    // Look ahead — is there a non-empty row after this?
    const next = aoa[i + 1] ?? [];
    if (rowIsEmpty(next)) continue;

    // Bias toward rows with mostly string cells (real headers).
    const stringRatio = nonEmpty.filter((c) => typeof c === "string").length / nonEmpty.length;
    if (stringRatio >= 0.5) return i;
  }
  // Fallback: first non-empty row.
  for (let i = 0; i < limit; i++) {
    if (!rowIsEmpty(aoa[i] ?? [])) return i;
  }
  return 0;
}

/** Normalise a header cell to a clean string column name. Empty → "col_N". */
function normaliseHeader(cell: unknown, index: number): string {
  if (cell === null || cell === undefined) return `col_${index + 1}`;
  const s = String(cell).trim();
  return s === "" ? `col_${index + 1}` : s;
}

/**
 * Normalise a data cell to a value the downstream coercers understand.
 * Dates come through as Date objects (cellDates: true) — we leave them as
 * Date so coerceDate can recognise them.
 */
function normaliseCell(cell: unknown): unknown {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return cell;
  if (typeof cell === "string") return cell.trim();
  return cell;
}

/** Best-effort format guess from the leading bytes (mostly informational). */
function detectFormat(bytes: Uint8Array): string {
  if (bytes.length < 4) return "unknown";
  // XLSX/XLSM (ZIP archive): PK\x03\x04
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "xlsx";
  }
  // Legacy XLS (compound document): D0 CF 11 E0
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return "xls";
  }
  return "unknown";
}
