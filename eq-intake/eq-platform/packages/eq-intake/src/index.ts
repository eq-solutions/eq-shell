/**
 * @eq/intake — the standalone parser for EQ.
 *
 * Public API:
 *   import { parseCsv } from '@eq/intake';
 *
 *   const parsed = await parseCsv(file);
 *   // parsed.rows are Record<string, unknown>[] ready to feed @eq/validation's validate()
 *
 * Readers planned:
 *   - CSV         (this sprint — Papa Parse, encoding/delimiter sniff, BOM strip)
 *   - XLSX        (next — SheetJS, multi-sheet, header-row detection)
 *   - PDF text    (Sprint C — born-digital PDFs)
 *   - PDF/image   (Sprint D — preprocessing + @eq/ai extract())
 *
 * After the readers exist, a top-level parseFile() orchestrates:
 *   readers → @eq/ai classify → @eq/ai map (or signature-cache hit) → @eq/validation
 */

export { parseCsv } from "./readers/csv.js";
export type {
  ParsedSheet,
  ParseCsvOptions,
  ParseMeta,
  CsvRow,
} from "./readers/csv.js";

export { parseXlsx } from "./readers/xlsx.js";
export type {
  ParsedWorkbook,
  ParsedXlsxSheet,
  ParseXlsxOptions,
  WorkbookMeta,
} from "./readers/xlsx.js";

export { classifySheet } from "./classify.js";
export type {
  ClassifyOptions,
  ClassifyResult,
  SchemaRegistry,
} from "./classify.js";

export { parsePdf } from "./readers/pdf.js";
export type {
  ParsedPdf,
  ParsedPdfSheet,
  ParsePdfOptions,
  PdfMeta,
} from "./readers/pdf.js";

export { parsePhoto } from "./readers/photo.js";
export type { ParsePhotoOptions } from "./readers/photo.js";

export { parseFile } from "./parse-file.js";
export type {
  ParseFileInput,
  ParseFileOptions,
  ParseFileResult,
  ParseFileMeta,
  FileFormat,
} from "./parse-file.js";

// ── Tidy Our Data ─────────────────────────────────────────────────────────
export { runTidyPass, commitTidyFixes, TIDY_ENTITY_TABLES } from "./tidy-pass.js";
export { runOrphanCheck } from "./orphan-check.js";
export type {
  TidyEntity,
  TidyFix,
  TidyFixType,
  GapItem,
  GapType,
  OrphanItem,
  OrphanType,
  ReviewFlag,
  TidyReport,
  TidyPassOpts,
  TidyCommitOpts,
  TidyCommitResult,
  OrphanCheckOpts,
  OrphanCheckResult,
} from "./tidy-types.js";
