/**
 * Photo / scanned-PDF reader.
 *
 * Routes the input bytes through @eq/ai's extract() (Claude Vision) and
 * shapes the result as a ParsedSheet that downstream consumers (validation,
 * confirm UI) handle identically to CSV / XLSX / PDF output.
 *
 * Single-record shape: vision extraction returns one canonical record per
 * document. The output ParsedSheet has one row whose keys are the canonical
 * fields the AI extracted. If the AI flagged any uncertain fields, those
 * surface as additional metadata that the orchestrator can attach to the
 * ParsedSheet (callers see them via the rows' field values and the meta
 * structure documents that the source was vision).
 *
 * Out of scope for v1:
 *   - Multi-record extraction (one photo = many rows). Real use case for
 *     this is a photographed tag-and-test register; revisit when needed.
 *   - Client-side preprocessing (deskew, crop, contrast). Claude Vision
 *     handles a wide range of camera shots without preprocessing; revisit
 *     if real-world quality drops below acceptable confidence.
 *   - Multi-page PDF handling. Vision is fed the whole PDF at once. For
 *     long PDFs the caller should split pages first.
 */

import type { AIProvider, ExtractResult } from "@eq/ai";
import type { ParsedSheet, CsvRow, ParseMeta } from "./csv.js";

export interface ParsePhotoOptions {
  /** Raw image / PDF bytes. */
  bytes: Buffer | Uint8Array | ArrayBuffer;
  /** MIME type, e.g. 'image/jpeg' or 'application/pdf'. */
  mediaType: string;
  /** AIProvider that will be invoked for extraction. */
  ai: AIProvider;
  /** Canonical JSON Schema describing the target entity. */
  targetSchema: Record<string, unknown>;
  /** Hint string for the AI (e.g. "prestart check from data centre site"). */
  documentTypeHint?: string;
}

/**
 * Returns an array of ParsedSheet so the callsite shape matches the other
 * readers. For images / single-page PDFs this is always a single-entry
 * array.
 */
export async function parsePhoto(opts: ParsePhotoOptions): Promise<ParsedSheet[]> {
  const fileBase64 = toBase64(opts.bytes);

  const result: ExtractResult = await opts.ai.extract({
    targetSchema: opts.targetSchema,
    fileBase64,
    mediaType: opts.mediaType,
    documentTypeHint: opts.documentTypeHint,
  });

  const headerRow = Object.keys(result.extracted);
  const row: CsvRow = { ...result.extracted };

  const meta: ParseMeta & {
    visionConfidence?: number;
    visionUncertainFields?: number;
    visionRawText?: string;
  } = {
    encoding: "vision-base64",
    delimiter: "ai-extract",
    totalRows: 1,
    emptyRowsSkipped: 0,
    malformedRows: 0,
    malformed: [],
    bomDetected: false,
    visionConfidence: aggregateConfidence(result),
    visionUncertainFields: result.uncertainFields.length,
    visionRawText: result.rawText,
  };

  return [
    {
      sheetName: "vision_extract",
      headerRow,
      rows: [row],
      meta,
    },
  ];
}

/**
 * Aggregate per-field confidence into one number for the UI to gate on.
 * Strategy: mean of per-field confidence, weighted equally. Empty/undefined
 * field-confidence yields 0 (treated as low confidence by callers).
 */
function aggregateConfidence(result: ExtractResult): number {
  const values = Object.values(result.fieldConfidence);
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function toBase64(input: Buffer | Uint8Array | ArrayBuffer): string {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBufferLike);

  // Node path
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser path (no Buffer)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // btoa is browser-only; we already covered Node above
  return btoa(binary);
}
