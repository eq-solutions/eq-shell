/**
 * PDF reader — born-digital text path.
 *
 * Strategy:
 *   1. Use unpdf (Workers-friendly PDF.js) to read every page's text items
 *      WITH their x/y coordinates (page.getTextContent()).
 *   2. Position-aware table detection: cluster items into rows by y and into
 *      columns by x, then read the grid off. This is what makes real
 *      born-digital registers work — unpdf's plain extractText() collapses all
 *      whitespace to single spaces, so a cell like "Main Switchboard" is
 *      indistinguishable from two columns without the coordinates.
 *   3. If the page isn't a grid, fall back to the text heuristic (tab / multi-
 *      space) and finally to a single-column "raw_text" ParsedSheet the caller
 *      can route to the vision path.
 *
 * What this does NOT do (deferred):
 *   - OCR for scanned PDFs (use the photo reader for that)
 *   - Form-field extraction (PDF forms are a separate API)
 */

import { getDocumentProxy } from "unpdf";
import type { ParsedSheet, ParseMeta, CsvRow } from "./csv.js";

export interface ParsedPdf {
  /** One ParsedSheet per detected page-or-table. */
  sheets: ParsedPdfSheet[];
  /** Top-level metadata. */
  meta: PdfMeta;
}

export interface ParsedPdfSheet extends ParsedSheet {
  /** 1-based page number this sheet was extracted from. */
  pageNumber: number;
  /** How the columns were detected. */
  layout: "tabular" | "raw_text";
}

export interface PdfMeta {
  totalPages: number;
  returnedSheets: number;
  /** True if any page produced no extractable text — likely scanned. */
  hasScannedPages: boolean;
}

export interface ParsePdfOptions {
  /**
   * If specified, only this page is parsed (1-based).
   */
  pageNumber?: number;
  /**
   * Force layout interpretation per page. Default 'auto'.
   */
  layout?: "auto" | "tabular" | "raw_text";
  /**
   * Min rows needed before considering a page a table. Default 3.
   * Below this, the page is returned as raw_text.
   */
  minTabularRows?: number;
}

/** Parse a PDF into one ParsedSheet per page (or per detected table). */
export async function parsePdf(
  input: Buffer | Uint8Array | ArrayBuffer,
  opts: ParsePdfOptions = {},
): Promise<ParsedPdf> {
  const bytes = toUint8(input);

  const pdf = await getDocumentProxy(bytes);
  const totalPages = pdf.numPages;
  const layout = opts.layout ?? "auto";
  const minRows = opts.minTabularRows ?? 3;

  const targetPages = opts.pageNumber
    ? [opts.pageNumber].filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  const sheets: ParsedPdfSheet[] = [];
  let scannedPageCount = 0;

  for (const pageNum of targetPages) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = positionItems(textContent);

    if (items.length === 0) {
      // No extractable text — likely a scanned page. Route to vision upstream.
      scannedPageCount++;
      continue;
    }

    // Position-aware grid detection first (unless the caller forced raw_text).
    const positional = layout === "raw_text" ? null : tableFromPositions(items, minRows);
    if (positional) {
      sheets.push({
        sheetName: `page_${pageNum}`,
        headerRow: positional.headerRow,
        rows: positional.rows,
        meta: tableMeta(positional.rows.length),
        pageNumber: pageNum,
        layout: "tabular",
      });
      continue;
    }

    // Fall back to the text heuristic (tab / multi-space) and raw_text.
    const parsed = parsePageText(reconstructText(items), layout, minRows);
    sheets.push({
      sheetName: `page_${pageNum}`,
      headerRow: parsed.headerRow,
      rows: parsed.rows,
      meta: parsed.meta,
      pageNumber: pageNum,
      layout: parsed.layout,
    });
  }

  return {
    sheets,
    meta: {
      totalPages,
      returnedSheets: sheets.length,
      hasScannedPages: scannedPageCount > 0,
    },
  };
}

// ============================================================================
// POSITION-AWARE TABLE DETECTION
// ============================================================================

/** A text item with its baseline position on the page. */
interface PosItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Pull positioned text items from a pdf.js TextContent. Whitespace-only items
 * are dropped — pdf.js emits a spacer item between columns whose width is the
 * gap; we recover columns from the real items' x-positions instead.
 */
function positionItems(textContent: unknown): PosItem[] {
  const items = (textContent as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: PosItem[] = [];
  for (const raw of items) {
    const it = raw as { str?: unknown; transform?: unknown };
    const str = typeof it.str === "string" ? it.str.trim() : "";
    const t = it.transform;
    if (str === "" || !Array.isArray(t) || t.length < 6) continue;
    out.push({ str, x: Number(t[4]), y: Number(t[5]) });
  }
  return out;
}

/** Cluster items into visual rows by shared baseline y (top of page first). */
function groupIntoRows(items: PosItem[], yTolerance = 4): PosItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PosItem[][] = [];
  for (const it of sorted) {
    const cur = rows[rows.length - 1];
    if (cur && Math.abs(cur[0]!.y - it.y) <= yTolerance) cur.push(it);
    else rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/** Distinct column x-positions — start a new column when the x-gap exceeds tol. */
function detectColumnXs(rows: PosItem[][], xTolerance = 10): number[] {
  const xs = rows.flat().map((it) => it.x).sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) {
    if (cols.length === 0 || x - cols[cols.length - 1]! > xTolerance) cols.push(x);
  }
  return cols;
}

/**
 * Read a grid off the positioned items. Returns null when the page doesn't
 * look like a table (fewer than 2 columns, too few rows, or most rows only
 * fill one column).
 */
function tableFromPositions(
  items: PosItem[],
  minRows: number,
): { headerRow: string[]; rows: CsvRow[] } | null {
  const rows = groupIntoRows(items);
  if (rows.length < minRows) return null;

  const cols = detectColumnXs(rows);
  if (cols.length < 2) return null;

  // Snap each item to its nearest column; multiple items in one cell join with a space.
  const matrix: string[][] = rows.map((row) => {
    const cells = new Array<string>(cols.length).fill("");
    for (const it of row) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < cols.length; i++) {
        const d = Math.abs(it.x - cols[i]!);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      cells[best] = cells[best] ? `${cells[best]} ${it.str}` : it.str;
    }
    return cells;
  });

  // A real table has most rows spanning ≥2 columns.
  const wellFormed = matrix.filter((r) => r.filter((c) => c !== "").length >= 2).length;
  if (wellFormed < minRows) return null;

  const headerRow = (matrix[0] ?? []).map((h, i) => h.trim() || `col_${i + 1}`);
  const dataRows: CsvRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: CsvRow = {};
    for (let c = 0; c < headerRow.length; c++) {
      obj[headerRow[c]!] = (cells[c] ?? "").trim();
    }
    dataRows.push(obj);
  }
  if (dataRows.length === 0) return null;

  return { headerRow, rows: dataRows };
}

/** Reconstruct page text (rows joined by newline) for the text-heuristic fallback. */
function reconstructText(items: PosItem[]): string {
  return groupIntoRows(items)
    .map((r) => r.map((it) => it.str).join(" "))
    .join("\n");
}

function tableMeta(totalRows: number): ParseMeta {
  return {
    encoding: "pdf-text",
    delimiter: "position",
    totalRows,
    emptyRowsSkipped: 0,
    malformedRows: 0,
    malformed: [],
    bomDetected: false,
  };
}

// ============================================================================
// LAYOUT DETECTION (text-heuristic fallback)
// ============================================================================

interface ParsedPage {
  headerRow: string[];
  rows: CsvRow[];
  meta: ParseMeta;
  layout: "tabular" | "raw_text";
}

/**
 * Exposed for unit testing only — turns a single page's extracted text
 * into a ParsedPage using the same heuristics the full parser uses.
 */
export function _parsePageTextForTest(
  text: string,
  layout: "auto" | "tabular" | "raw_text" = "auto",
  minTabularRows = 3,
): ParsedPage {
  return parsePageText(text, layout, minTabularRows);
}

function parsePageText(
  text: string,
  layout: "auto" | "tabular" | "raw_text",
  minTabularRows: number,
): ParsedPage {
  if (layout === "raw_text") {
    return rawTextPage(text);
  }

  // Split into non-empty lines
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < minTabularRows) {
    return layout === "tabular"
      ? emptyTablePage(text)
      : rawTextPage(text);
  }

  // Try tab-delimited first (single \t, so empty middle cells survive),
  // then multi-space delimited (2+ spaces collapses to one boundary).
  const tabSplit = lines.map((l) => l.split(/\t/));
  if (isConsistentTable(tabSplit, minTabularRows)) {
    return buildTablePage(tabSplit);
  }

  const spaceSplit = lines.map((l) => l.split(/ {2,}/));
  if (isConsistentTable(spaceSplit, minTabularRows)) {
    return buildTablePage(spaceSplit);
  }

  return layout === "tabular" ? emptyTablePage(text) : rawTextPage(text);
}

/**
 * "Consistent" = the first row defines a column count, and at least
 * minTabularRows-1 subsequent rows have that same count (±1 tolerance for
 * trailing-empty quirks).
 */
function isConsistentTable(rows: string[][], minRows: number): boolean {
  if (rows.length === 0) return false;
  const head = rows[0]!;
  if (head.length < 2) return false;
  const target = head.length;
  let matching = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (Math.abs(row.length - target) <= 1) matching++;
  }
  return matching + 1 >= minRows;
}

function buildTablePage(rows: string[][]): ParsedPage {
  const headerRow = (rows[0] ?? []).map((h, i) => h.trim() || `col_${i + 1}`);
  const dataRows: CsvRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: CsvRow = {};
    for (let c = 0; c < headerRow.length; c++) {
      obj[headerRow[c]!] = (cells[c] ?? "").trim();
    }
    dataRows.push(obj);
  }

  return {
    headerRow,
    rows: dataRows,
    meta: {
      encoding: "pdf-text",
      delimiter: "whitespace",
      totalRows: dataRows.length,
      emptyRowsSkipped: 0,
      malformedRows: 0,
      malformed: [],
      bomDetected: false,
    },
    layout: "tabular",
  };
}

function rawTextPage(text: string): ParsedPage {
  return {
    headerRow: ["raw_text"],
    rows: [{ raw_text: text.trim() }],
    meta: {
      encoding: "pdf-text",
      delimiter: "none",
      totalRows: 1,
      emptyRowsSkipped: 0,
      malformedRows: 0,
      malformed: [],
      bomDetected: false,
    },
    layout: "raw_text",
  };
}

function emptyTablePage(text: string): ParsedPage {
  return {
    headerRow: [],
    rows: [],
    meta: {
      encoding: "pdf-text",
      delimiter: "whitespace",
      totalRows: 0,
      emptyRowsSkipped: 0,
      malformedRows: 0,
      malformed: [],
      bomDetected: false,
    },
    layout: "tabular",
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function toUint8(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input as ArrayBufferLike);
}
