/**
 * PDF reader — born-digital text path.
 *
 * Strategy:
 *   1. Use unpdf (Workers-friendly PDF.js) to pull text from every page.
 *   2. Heuristically detect a tabular layout (consistent delimiter per row).
 *   3. If found, return rows keyed by detected header. If not, return a
 *      single-column "raw_text" ParsedSheet so the caller can route to the
 *      vision path for layout-aware extraction.
 *
 * What this does NOT do (deferred):
 *   - Position-aware table detection (would need pdf.js TextItem coords)
 *   - OCR for scanned PDFs (use the photo reader for that)
 *   - Form-field extraction (PDF forms are a separate API)
 *
 * Real-world success rate: ~50% of born-digital PDFs (CSV-like exports,
 * simple Xero invoices). Complex layouts fall through to vision.
 */

import { getDocumentProxy, extractText } from "unpdf";
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

  // unpdf's extractText returns the text from all pages by default.
  // We re-run it per page to keep per-page boundaries clean.
  for (const pageNum of targetPages) {
    const pageText = await extractPageText(pdf, pageNum);

    if (pageText.trim().length === 0) {
      scannedPageCount++;
      continue;
    }

    const parsed = parsePageText(pageText, layout, minRows);
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
// PAGE TEXT EXTRACTION
// ============================================================================

async function extractPageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNum: number,
): Promise<string> {
  // unpdf doesn't currently expose a single-page extractText, but the
  // mergePages-false variant gives us an array of per-page strings.
  // We grab the one we need and discard the rest.
  const { text } = await extractText(pdf, { mergePages: false });
  if (Array.isArray(text)) {
    return text[pageNum - 1] ?? "";
  }
  // Defensive fallback if the unpdf API changes shape — return everything.
  return String(text ?? "");
}

// ============================================================================
// LAYOUT DETECTION
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
