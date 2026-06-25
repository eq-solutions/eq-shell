/**
 * to-canonical.ts — turn a raw `CalibrationCertRecord` into an `asset`
 * update/insert candidate (`CalCertAssetCandidate`), with warnings.
 *
 * Field mapping (cert → schemas/asset.schema.json):
 *   ASSET NUMBER / CMX BARCODE → external_id       (the (tenant, external_id) upsert key)
 *   SERIAL NUMBER              → serial_number
 *   make / model               → make / model
 *   UNIT UNDER TEST            → name               (new rows only)
 *   CAL DATE                   → last_service_date
 *   CAL DUE                    → next_service_due
 *   TEST RESULT                → cal_result         (normalised; non-pass is flagged)
 */
import type {
  CalCertAssetCandidate,
  CalCertResult,
  CalCertSourceTag,
  CalibrationCertRecord,
  SkillWarning,
} from "./types.js";

export interface MappedCert {
  candidate: CalCertAssetCandidate;
  warnings: SkillWarning[];
}

export function mapRecordToCandidate(
  raw: CalibrationCertRecord & { source: CalCertSourceTag },
): MappedCert {
  const warnings: SkillWarning[] = [];
  const certRef = raw.cert_number ?? raw.asset_number ?? "<cert>";

  const externalId = nullIfBlank(raw.asset_number);

  // Serial guard: vision sometimes echoes the asset tag into the serial field
  // when the printed serial is blank/illegible. Drop it rather than match an
  // instrument on its own asset tag.
  let serial = nullIfBlank(raw.serial_number);
  if (serial && externalId && normaliseSerial(serial) === normaliseSerial(externalId)) {
    warnings.push({
      code: "serial_echoes_tag",
      message: `${certRef}: serial '${serial}' equals the asset tag — treated as missing serial.`,
      context: { cert: certRef, asset_number: externalId },
    });
    serial = null;
  }

  const last = coerceCertDate(raw.cal_date);
  const next = coerceCertDate(raw.cal_due);
  if (raw.cal_date && !last) {
    warnings.push({
      code: "invalid_date",
      message: `${certRef}: CAL DATE '${raw.cal_date}' is not a recognised date.`,
      context: { cert: certRef, field: "cal_date", value: raw.cal_date },
    });
  }
  if (raw.cal_due && !next) {
    warnings.push({
      code: "invalid_date",
      message: `${certRef}: CAL DUE '${raw.cal_due}' is not a recognised date.`,
      context: { cert: certRef, field: "cal_due", value: raw.cal_due },
    });
  }
  if (!last && !next) {
    warnings.push({
      code: "missing_field",
      message: `${certRef}: neither CAL DATE nor CAL DUE parsed.`,
      context: { cert: certRef },
    });
  }

  const result = mapResult(raw.test_result);
  if (result === "unknown" && nullIfBlank(raw.test_result)) {
    warnings.push({
      code: "unknown_result",
      message: `${certRef}: unrecognised TEST RESULT '${raw.test_result}'.`,
      context: { cert: certRef, value: raw.test_result },
    });
  } else if (result === "fail" || result === "limited") {
    warnings.push({
      code: "non_pass_result",
      message: `${certRef}: result is '${raw.test_result}' — do not auto-mark fully calibrated; reviewer must confirm.`,
      context: { cert: certRef, result },
    });
  }

  const candidate: CalCertAssetCandidate = {
    external_id: externalId,
    serial_number: serial,
    make: nullIfBlank(raw.make),
    model: nullIfBlank(raw.model),
    name: buildName(raw),
    last_service_date: last,
    next_service_due: next,
    cal_result: result,
    certificate_number: nullIfBlank(raw.cert_number),
    source: raw.source,
  };

  return { candidate, warnings };
}

/** Build a display name for a NEW asset row from the cert. */
function buildName(raw: CalibrationCertRecord): string {
  const unit = nullIfBlank(raw.unit_under_test);
  if (unit) return unit;
  const mm = [nullIfBlank(raw.make), nullIfBlank(raw.model)].filter(Boolean).join(" ");
  if (mm) return mm;
  return nullIfBlank(raw.asset_number) ?? "Calibrated instrument";
}

/** Normalise a serial/tag for comparison: uppercase, strip non-alphanumerics. */
export function normaliseSerial(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Map a printed TEST RESULT to a normalised outcome. */
export function mapResult(raw: string | null | undefined): CalCertResult {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v.includes("limited")) return "limited";
  if (v.includes("fail")) return "fail";
  if (v.includes("pass")) return "pass";
  return "unknown";
}

/** Coerce cert date strings (`dd-MMM-yyyy`, `dd/MM/yyyy`, ISO) to `yyyy-mm-dd`. */
export function coerceCertDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // dd-MMM-yyyy (e.g. "28-Apr-2026")
  const monthMatch = trimmed.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1]!, 10);
    const monthIdx = MONTH_ABBR.indexOf(monthMatch[2]!.toLowerCase().slice(0, 3));
    const year = parseInt(monthMatch[3]!, 10);
    if (monthIdx !== -1) {
      return `${pad4(year)}-${pad2(monthIdx + 1)}-${pad2(day)}`;
    }
  }

  // dd/MM/yyyy
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]!, 10);
    const month = parseInt(slashMatch[2]!, 10);
    const year = parseInt(slashMatch[3]!, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // ISO already
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].+)?$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  return null;
}

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}
function nullIfBlank(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
