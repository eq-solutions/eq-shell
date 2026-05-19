/**
 * processCapture — orchestrator for the EQ Capture path.
 *
 * Takes a captured image/PDF (base64) plus a target canonical schema,
 * runs AI vision extraction, then runs the same validate() engine the
 * Import path uses. Returns the same valid_rows / flagged_rows /
 * rejected_rows shape, plus capture-specific flags (low confidence,
 * illegible regions) and the extract metadata so the UI can display
 * "this looks like 3 pages, signed, photo capture" etc.
 */

import type { AIProvider, ExtractInput, ExtractMetadata, ExtractResult } from "@eq/ai";
import { validate } from "./validate.js";
import type { ValidationResult, ValidateOpts } from "./validate.js";

export type CaptureFlag =
  | { kind: "low_extraction_confidence"; field: string; confidence: number }
  | { kind: "illegible_region"; description: string }
  | { kind: "extract_warning"; type: string; message: string };

export interface ProcessCaptureOpts {
  /** AI provider implementing extract(). Mockable for tests. */
  ai: AIProvider;
  /** Canonical schema for the target entity. */
  schema: Record<string, unknown>;
  /** Base64-encoded image/PDF body. */
  fileBase64: string;
  /** Media type of fileBase64. */
  mediaType: ExtractInput["mediaType"];
  /** Owning tenant for FK + audit. */
  tenantId: string;
  /** Optional FK lookup. */
  fkLookup?: ValidateOpts["fkLookup"];
  /** Confidence threshold below which a field is flagged. Default 0.7. */
  flagConfidenceBelow?: number;
  /** Pass-through to validate(). */
  locale?: ValidateOpts["locale"];
}

export interface ProcessCaptureResult extends ValidationResult {
  /** Capture-specific flags layered on top of validation flags. */
  capture_flags: CaptureFlag[];
  /** Metadata reported by the extract step (page count, signed, etc). */
  extract_metadata: ExtractMetadata;
  /** Raw extracted record before validation, for debugging. */
  raw_extracted: Record<string, unknown>;
}

export async function processCapture(opts: ProcessCaptureOpts): Promise<ProcessCaptureResult> {
  const flagThreshold = opts.flagConfidenceBelow ?? 0.7;

  // 1. AI vision extraction.
  const extracted: ExtractResult = await opts.ai.extract({
    targetSchema: opts.schema,
    fileBase64: opts.fileBase64,
    mediaType: opts.mediaType,
  });

  // 2. Build capture-specific flags from extraction confidence + illegible regions.
  const capture_flags: CaptureFlag[] = [];
  for (const [field, confidence] of Object.entries(extracted.fieldConfidence)) {
    if (confidence < flagThreshold) {
      capture_flags.push({ kind: "low_extraction_confidence", field, confidence });
    }
  }
  for (const region of extracted.illegibleRegions) {
    capture_flags.push({ kind: "illegible_region", description: region });
  }
  for (const w of extracted.warnings) {
    capture_flags.push({ kind: "extract_warning", type: String(w.type), message: w.message });
  }

  // 3. Map every extracted field to itself (one-to-one) and run validate().
  //    The extracted record is already in canonical shape (the AI prompt
  //    targets the canonical schema), so the mapping is identity.
  const extractedKeys = Object.keys(extracted.extracted);
  const mapping: Record<string, string | null> = {};
  for (const k of extractedKeys) mapping[k] = k;

  const validation = await validate({
    schema: opts.schema,
    mapping,
    rows: [extracted.extracted],
    tenantId: opts.tenantId,
    fkLookup: opts.fkLookup,
    locale: opts.locale,
  });

  return {
    ...validation,
    capture_flags,
    extract_metadata: extracted.metadata,
    raw_extracted: extracted.extracted,
  };
}
