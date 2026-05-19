/**
 * parseFile — the one entry point.
 *
 * Hands any of CSV / XLSX / PDF / image (well, photo via vision when AI is
 * supplied) into a uniform ParsedSheet[] result. The right reader is picked
 * by:
 *   1. Explicit `format` option if supplied
 *   2. File extension (when the input is a File or carries a name)
 *   3. Magic bytes at the start of the buffer
 *
 * Output is always an array of ParsedSheet — CSVs return a single-entry
 * array, multi-sheet XLSX files return one per worksheet, PDFs return one
 * per page (or per detected table).
 *
 * Downstream consumers (the confirm-flow driver, headless callers) iterate
 * the array and route each ParsedSheet through @eq/validation's validate().
 */

import { parseCsv, type ParsedSheet, type CsvRow } from "./readers/csv.js";
import { parseXlsx } from "./readers/xlsx.js";
import { parsePdf } from "./readers/pdf.js";
import { parsePhoto } from "./readers/photo.js";
import type { AIProvider } from "@eq/ai";

export type FileFormat = "csv" | "xlsx" | "pdf" | "image" | "unknown";

export interface ParseFileInput {
  /** Raw bytes of the file. */
  bytes: Buffer | Uint8Array | ArrayBuffer;
  /** Optional file name — used as a hint for format detection. */
  fileName?: string;
  /** Force a specific format. Default: auto-detect. */
  format?: FileFormat;
}

export interface ParseFileOptions {
  /** AI provider for photo/scanned-PDF extraction. Required for image formats. */
  ai?: AIProvider;
  /**
   * Target canonical schema for vision extraction. Required when AI is
   * called (photo/scanned PDF), unused otherwise.
   */
  visionTargetSchema?: Record<string, unknown>;
  /** MIME type hint for vision (passed through to ai.extract). */
  visionMediaType?: string;
}

export interface ParseFileResult {
  /** Format that was actually used. */
  format: FileFormat;
  /** One ParsedSheet per logical sheet/page/document. */
  sheets: ParsedSheet[];
  /** Top-level metadata about the parse. */
  meta: ParseFileMeta;
}

export interface ParseFileMeta {
  fileName?: string;
  detectedFrom: "explicit" | "extension" | "magic_bytes" | "fallback";
  /** Set when the PDF reader saw scanned (no extractable text) pages. */
  hasScannedPages?: boolean;
}

/**
 * Auto-detect format and parse. The single entry point any consuming app
 * should call.
 */
export async function parseFile(
  input: ParseFileInput,
  opts: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const bytes = toUint8(input.bytes);
  const detection = detectFormat(bytes, input.fileName, input.format);

  switch (detection.format) {
    case "csv": {
      const sheet = await parseCsv(bytes, {
        sheetName: input.fileName ?? "csv",
      });
      return {
        format: "csv",
        sheets: [sheet],
        meta: {
          fileName: input.fileName,
          detectedFrom: detection.via,
        },
      };
    }

    case "xlsx": {
      const wb = await parseXlsx(bytes);
      return {
        format: "xlsx",
        sheets: wb.sheets,
        meta: {
          fileName: input.fileName,
          detectedFrom: detection.via,
        },
      };
    }

    case "pdf": {
      const pdf = await parsePdf(bytes);
      // If every page came back scanned (no text), route to the vision path
      if (pdf.meta.hasScannedPages && pdf.sheets.length === 0 && opts.ai) {
        return parseAsPhoto(bytes, input.fileName, "application/pdf", opts);
      }
      return {
        format: "pdf",
        sheets: pdf.sheets,
        meta: {
          fileName: input.fileName,
          detectedFrom: detection.via,
          hasScannedPages: pdf.meta.hasScannedPages,
        },
      };
    }

    case "image": {
      const mediaType = opts.visionMediaType ?? guessImageMime(bytes, input.fileName);
      return parseAsPhoto(bytes, input.fileName, mediaType, opts);
    }

    default: {
      // Last-ditch: try CSV, then XLSX
      try {
        const sheet = await parseCsv(bytes, { sheetName: input.fileName ?? "fallback" });
        return {
          format: "csv",
          sheets: [sheet],
          meta: {
            fileName: input.fileName,
            detectedFrom: "fallback",
          },
        };
      } catch {
        const wb = await parseXlsx(bytes);
        return {
          format: "xlsx",
          sheets: wb.sheets,
          meta: {
            fileName: input.fileName,
            detectedFrom: "fallback",
          },
        };
      }
    }
  }
}

// ============================================================================
// FORMAT DETECTION
// ============================================================================

interface Detection {
  format: FileFormat;
  via: ParseFileMeta["detectedFrom"];
}

function detectFormat(
  bytes: Uint8Array,
  fileName: string | undefined,
  explicit: FileFormat | undefined,
): Detection {
  if (explicit) return { format: explicit, via: "explicit" };

  // Extension hint
  if (fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
      return { format: "csv", via: "extension" };
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
      return { format: "xlsx", via: "extension" };
    }
    if (lower.endsWith(".pdf")) {
      return { format: "pdf", via: "extension" };
    }
    if (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".heic")
    ) {
      return { format: "image", via: "extension" };
    }
  }

  // Magic bytes
  if (bytes.length >= 4) {
    // PDF: "%PDF"
    if (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    ) {
      return { format: "pdf", via: "magic_bytes" };
    }
    // XLSX (ZIP): PK\x03\x04
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    ) {
      return { format: "xlsx", via: "magic_bytes" };
    }
    // Legacy XLS: D0 CF 11 E0
    if (
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    ) {
      return { format: "xlsx", via: "magic_bytes" };
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { format: "image", via: "magic_bytes" };
    }
    // PNG: 89 50 4E 47
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return { format: "image", via: "magic_bytes" };
    }
    // GIF: "GIF8"
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return { format: "image", via: "magic_bytes" };
    }
  }

  // Text-shape heuristic: if the first 256 bytes are all printable ASCII or
  // common whitespace, assume CSV.
  const sample = bytes.subarray(0, Math.min(bytes.length, 256));
  let printableCount = 0;
  for (const b of sample) {
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) {
      printableCount++;
    }
  }
  if (sample.length > 0 && printableCount / sample.length > 0.95) {
    return { format: "csv", via: "magic_bytes" };
  }

  return { format: "unknown", via: "fallback" };
}

function guessImageMime(bytes: Uint8Array, fileName?: string): string {
  if (fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".heic")) return "image/heic";
  }
  if (bytes.length >= 3) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
      return "image/png";
  }
  return "image/jpeg";
}

// ============================================================================
// PHOTO PATH
// ============================================================================

async function parseAsPhoto(
  bytes: Uint8Array,
  fileName: string | undefined,
  mediaType: string,
  opts: ParseFileOptions,
): Promise<ParseFileResult> {
  if (!opts.ai) {
    throw new Error(
      "parseFile: image / scanned-PDF input but no AIProvider supplied. Pass opts.ai to enable the vision path.",
    );
  }
  if (!opts.visionTargetSchema) {
    throw new Error(
      "parseFile: image / scanned-PDF input requires opts.visionTargetSchema (the canonical schema to extract into).",
    );
  }
  const sheets = await parsePhoto({
    bytes,
    mediaType,
    ai: opts.ai,
    targetSchema: opts.visionTargetSchema,
  });
  return {
    format: mediaType === "application/pdf" ? "pdf" : "image",
    sheets,
    meta: {
      fileName,
      detectedFrom: "magic_bytes",
    },
  };
}

function toUint8(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input as ArrayBufferLike);
}

// Re-export the row type for callers
export type { CsvRow };
