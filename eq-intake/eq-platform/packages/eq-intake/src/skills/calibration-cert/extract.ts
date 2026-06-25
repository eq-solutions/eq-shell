/**
 * Extraction layer — turns one calibration-cert PDF into raw
 * `CalibrationCertRecord[]` via vision.
 *
 * Unlike the maximo skill there is deliberately NO text fast-path: the
 * Trescal cert's two-column header scrambles label/value order in the
 * extracted text layer, and several certs in a bundle are image-only scans —
 * so field parsing from text is unreliable. We always route to vision when an
 * AIProvider is supplied, and emit a `vision_unavailable` warning when it
 * isn't (rather than guessing from scrambled text).
 */
import type { AIProvider } from "@eq/ai";
import { CALIBRATION_CERT_EXTRACT_SCHEMA } from "./schema.js";
import type {
  CalCertFileSource,
  CalCertSourceTag,
  CalibrationCertRecord,
  SkillFileInput,
  SkillWarning,
} from "./types.js";

export interface ExtractCertResult {
  records: Array<CalibrationCertRecord & { source: CalCertSourceTag }>;
  source: CalCertFileSource;
  warnings: SkillWarning[];
}

/** Extract raw cert records from a single PDF input via vision. */
export async function extractCertsFromPdf(
  file: SkillFileInput,
  ai: AIProvider | undefined,
): Promise<ExtractCertResult> {
  if (!ai) {
    return {
      records: [],
      source: {
        file_name: file.fileName,
        page_count: 0,
        extracted_via: "vision",
        records_emitted: 0,
      },
      warnings: [
        {
          code: "vision_unavailable",
          message: `Calibration cert '${file.fileName ?? "<unnamed>"}' needs vision extraction but no AIProvider was supplied. Pass opts.ai to enable it.`,
        },
      ],
    };
  }

  const bytes = cloneBytes(file.bytes);
  const fileBase64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : bytesToBase64Browser(bytes);

  const extracted = await ai.extract({
    targetSchema: CALIBRATION_CERT_EXTRACT_SCHEMA,
    fileBase64,
    mediaType: "application/pdf",
    documentTypeHint:
      "Calibration / test certificate (Trescal or similar ISO-17025 lab). May staple several certs. " +
      "Two-column header — keep ASSET NUMBER and SERIAL NUMBER distinct.",
  });

  const warnings: SkillWarning[] = [];

  const rawCerts = extracted.extracted?.["certificates"];
  if (!Array.isArray(rawCerts)) {
    warnings.push({
      code: "no_records_extracted",
      message: `Vision extraction returned no 'certificates' array for ${file.fileName ?? "<unnamed PDF>"}.`,
    });
    return {
      records: [],
      source: {
        file_name: file.fileName,
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
        message: `Vision flagged '${field}' as low-confidence (${Math.round(conf * 100)}%) in ${file.fileName ?? "<unnamed PDF>"}.`,
        context: { field, confidence: conf },
      });
    }
  }

  const records = rawCerts.map((c) => {
    const safe = c as Partial<CalibrationCertRecord>;
    return {
      asset_number: safe.asset_number ?? null,
      serial_number: safe.serial_number ?? null,
      make: safe.make ?? null,
      model: safe.model ?? null,
      unit_under_test: safe.unit_under_test ?? null,
      cal_date: safe.cal_date ?? null,
      cal_due: safe.cal_due ?? null,
      test_result: safe.test_result ?? null,
      cert_number: safe.cert_number ?? null,
      source: {
        file_name: file.fileName,
        extracted_via: "vision" as const,
      },
    };
  });

  return {
    records,
    source: {
      file_name: file.fileName,
      page_count: extracted.metadata?.estimatedPages ?? 0,
      extracted_via: "vision",
      records_emitted: records.length,
    },
    warnings,
  };
}

function cloneBytes(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  return new Uint8Array(input as ArrayBufferLike);
}

function bytesToBase64Browser(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
