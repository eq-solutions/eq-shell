/**
 * Extraction layer — turns one PDF's bytes into raw `MaximoWoRecord[]`.
 *
 * Routing:
 *   1. Try text extraction via the existing `parsePdf` reader.
 *   2. If the PDF text contains a recognisable Maximo WO header table,
 *      parse it line-by-line. (Best-case path; no AI cost.)
 *   3. Otherwise fall back to vision via the supplied AIProvider.
 *
 * Reality check: the fixture set (Equinix CCITTFax scans) returns zero
 * extractable text from every PDF, so all 4 fixtures hit the vision path.
 * Text path is wired up for the case where Maximo's PDF rendering ships a
 * born-digital print (which exists in other tenants).
 */
import { parsePdf } from "../../readers/pdf.js";
import type { AIProvider } from "@eq/ai";
import { MAXIMO_WO_EXTRACT_SCHEMA } from "./schema.js";
import type {
  MaximoWoRecord,
  SkillFileInput,
  SkillFileSource,
  SkillSourceTag,
  SkillWarning,
} from "./types.js";

export interface ExtractFileResult {
  records: Array<MaximoWoRecord & { source: SkillSourceTag }>;
  source: SkillFileSource;
  warnings: SkillWarning[];
}

/**
 * Extract raw WO records from a single PDF input. Routes to text or vision.
 */
export async function extractMaximoWosFromPdf(
  file: SkillFileInput,
  ai: AIProvider | undefined,
): Promise<ExtractFileResult> {
  // Clone bytes — pdfjs (under unpdf) transfers the underlying buffer when it
  // hands the PDF to its worker, which would leave callers with a detached
  // ArrayBuffer for any subsequent operation on the same input. Vision also
  // needs the bytes after text extraction, so we always work from a fresh
  // copy here.
  const bytesForText = cloneBytes(file.bytes);
  const bytesForVision = cloneBytes(file.bytes);

  // 1. Try the cheap text path first.
  let textParsed: Awaited<ReturnType<typeof parsePdf>> | undefined;
  try {
    textParsed = await parsePdf(bytesForText);
  } catch {
    // pdfjs occasionally throws on malformed scans (or per-process worker
    // state issues in some Node versions). Treat as "no text" and fall
    // through to vision rather than failing the whole skill.
    textParsed = undefined;
  }

  if (textParsed) {
    const textRecords = tryParseFromText(textParsed.sheets, file.fileName);
    if (textRecords.length > 0) {
      return {
        records: textRecords,
        source: {
          file_name: file.fileName,
          page_count: textParsed.meta.totalPages,
          extracted_via: "text",
          records_emitted: textRecords.length,
        },
        warnings: [],
      };
    }
  }
  const pageCountHint = textParsed?.meta.totalPages ?? 0;

  // 2. Vision fallback.
  if (!ai) {
    return {
      records: [],
      source: {
        file_name: file.fileName,
        page_count: pageCountHint,
        extracted_via: "vision",
        records_emitted: 0,
      },
      warnings: [
        {
          code: "vision_unavailable",
          message: `PDF '${file.fileName ?? "<unnamed>"}' has no extractable text and no AIProvider was supplied. Pass opts.ai to enable vision extraction.`,
        },
      ],
    };
  }

  const vision = await extractViaVision(bytesForVision, file.fileName, ai);
  return vision;
}

function cloneBytes(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  return new Uint8Array(input as ArrayBufferLike);
}

// ============================================================================
// TEXT PATH
// ============================================================================

/**
 * Best-effort parse of a Maximo WO header from extracted text. Maximo prints
 * the header table as a labelled key/value list — we look for the field
 * labels and harvest the value on the same line (or the next non-empty line).
 *
 * Returns an empty array if no recognisable header is found; the caller then
 * falls back to vision.
 */
function tryParseFromText(
  sheets: ReturnType<typeof parsePdf> extends Promise<infer R> ? (R extends { sheets: infer S } ? S : never) : never,
  fileName: string | undefined,
): Array<MaximoWoRecord & { source: SkillSourceTag }> {
  const out: Array<MaximoWoRecord & { source: SkillSourceTag }> = [];

  for (const sheet of sheets) {
    // Walk text either as a single raw_text blob or as tabular rows.
    const text = sheetToText(sheet);
    if (!text) continue;
    const records = parseHeaderTablesFromText(text);
    for (const r of records) {
      out.push({
        ...r,
        source: {
          file_name: fileName,
          extracted_via: "text",
          page_number: sheet.pageNumber,
        },
      });
    }
  }

  return out;
}

function sheetToText(sheet: { layout: string; rows: Array<Record<string, unknown>>; headerRow: string[] }): string {
  if (sheet.layout === "raw_text") {
    return String(sheet.rows[0]?.raw_text ?? "");
  }
  // Tabular — re-join rows so the regex matchers below can scan the page.
  const lines: string[] = [sheet.headerRow.join("\t")];
  for (const row of sheet.rows) {
    lines.push(sheet.headerRow.map((h) => String(row[h] ?? "")).join("\t"));
  }
  return lines.join("\n");
}

/**
 * Maximo header tables print labels and values either on the same line
 * (`Site: AU01-CA1`) or label-then-newline-then-value. Each WO has a
 * `WO# <num>` anchor — split text on those anchors to delimit each WO.
 */
function parseHeaderTablesFromText(text: string): MaximoWoRecord[] {
  const woAnchorRe = /WO\s*#\s*[:\s]*(\d{6,8})/gi;
  const anchors: Array<{ wo: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = woAnchorRe.exec(text)) !== null) {
    anchors.push({ wo: m[1]!, start: m.index });
  }
  if (anchors.length === 0) return [];

  const records: MaximoWoRecord[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const end = i + 1 < anchors.length ? anchors[i + 1]!.start : text.length;
    const segment = text.slice(a.start, end);
    const rec = parseSegment(a.wo, segment);
    if (rec) records.push(rec);
  }
  return records;
}

/**
 * Pull the labelled fields out of one WO segment. Lenient — missing fields
 * are returned as undefined; downstream code surfaces missing required
 * fields as warnings.
 */
function parseSegment(woNumber: string, segment: string): MaximoWoRecord | null {
  const get = (label: string): string | null => {
    // Label can be followed by ':' and/or whitespace and/or newline. Capture
    // up to the next label-like token or two consecutive newlines.
    const re = new RegExp(
      `${escapeRegex(label)}\\s*[:\\-]?\\s*([^\\n\\r]+?)\\s*(?=\\n[A-Z][A-Za-z #/]+\\s*[:\\-]|\\n\\n|$)`,
      "i",
    );
    const m = segment.match(re);
    return m ? m[1]!.trim() : null;
  };

  const site = get("Site");
  const asset = get("Asset");
  const jobPlan = get("Job Plan");
  if (!site || !asset || !jobPlan) return null;

  return {
    wo_number: woNumber,
    site,
    asset,
    serial_number: get("Serial #") ?? get("Serial"),
    status: get("Status"),
    location: get("Location"),
    work_type: get("Work Type"),
    priority: get("Priority"),
    job_plan: jobPlan,
    crew_id: get("CrewID") ?? get("Crew ID"),
    target_start: get("Target Start"),
    target_finish: get("Target Finish"),
    actual_start: get("Actual Start"),
    actual_finish: get("Actual Finish"),
    classification: get("Classification"),
    failure_code: get("Failure"),
    problem: get("Problem"),
    cause: get("Cause"),
    remedy: get("Remedy"),
    ir_scan_result: get("IR Scan p/f") ?? get("IR Scan"),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// VISION PATH
// ============================================================================

async function extractViaVision(
  bytes: Uint8Array,
  fileName: string | undefined,
  ai: AIProvider,
): Promise<ExtractFileResult> {
  const fileBase64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : bytesToBase64Browser(bytes);

  const extracted = await ai.extract({
    targetSchema: MAXIMO_WO_EXTRACT_SCHEMA,
    fileBase64,
    mediaType: "application/pdf",
    documentTypeHint:
      "IBM Maximo work order PDF — may contain one or multiple stapled WOs. Extract every WO header table.",
  });

  const warnings: SkillWarning[] = [];

  // Unwrap the array.
  const rawWos = extracted.extracted?.["work_orders"];
  if (!Array.isArray(rawWos)) {
    warnings.push({
      code: "no_records_extracted",
      message: `Vision extraction returned no 'work_orders' array for ${fileName ?? "<unnamed PDF>"}.`,
    });
    return {
      records: [],
      source: {
        file_name: fileName,
        page_count: extracted.metadata?.estimatedPages ?? 0,
        extracted_via: "vision",
        records_emitted: 0,
      },
      warnings,
    };
  }

  // Surface any low-confidence flags from vision.
  for (const [field, conf] of Object.entries(extracted.fieldConfidence ?? {})) {
    if (typeof conf === "number" && conf < 0.6) {
      warnings.push({
        code: "vision_low_confidence",
        message: `Vision flagged '${field}' as low-confidence (${Math.round(conf * 100)}%) in ${fileName ?? "<unnamed PDF>"}.`,
        context: { field, confidence: conf },
      });
    }
  }

  const records = rawWos.map((wo, idx) => {
    const safe = wo as Partial<MaximoWoRecord>;
    return {
      wo_number: String(safe.wo_number ?? "").trim(),
      site: String(safe.site ?? "").trim(),
      asset: String(safe.asset ?? "").trim(),
      serial_number: safe.serial_number ?? null,
      status: safe.status ?? null,
      location: safe.location ?? null,
      work_type: safe.work_type ?? null,
      priority: safe.priority ?? null,
      job_plan: String(safe.job_plan ?? "").trim(),
      crew_id: safe.crew_id ?? null,
      target_start: safe.target_start ?? null,
      target_finish: safe.target_finish ?? null,
      actual_start: safe.actual_start ?? null,
      actual_finish: safe.actual_finish ?? null,
      classification: safe.classification ?? null,
      failure_code: safe.failure_code ?? null,
      problem: safe.problem ?? null,
      cause: safe.cause ?? null,
      remedy: safe.remedy ?? null,
      ir_scan_result: safe.ir_scan_result ?? null,
      source: {
        file_name: fileName,
        extracted_via: "vision" as const,
        page_number: undefined,
      },
      __vision_index: idx,
    };
  });

  // Drop the helper index from the public shape.
  const cleaned = records.map(({ __vision_index: _ignored, ...r }) => r);

  return {
    records: cleaned,
    source: {
      file_name: fileName,
      page_count: extracted.metadata?.estimatedPages ?? 0,
      extracted_via: "vision",
      records_emitted: cleaned.length,
    },
    warnings,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function bytesToBase64Browser(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
