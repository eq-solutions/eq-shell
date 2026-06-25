/**
 * Extraction-time JSON Schema for the AI vision prompt.
 *
 * Wraps a calibration-certificate record schema in `{ certificates: [...] }`
 * so one PDF (lab bundles can staple several certs) returns an array in a
 * single round-trip. The skill unwraps `extracted.certificates` after the
 * call.
 *
 * This is NOT a canonical entity schema — it exists only to shape the vision
 * prompt. Canonical mapping is done by `to-canonical.ts`.
 */
export const CALIBRATION_CERT_EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  "x-eq-entity": "calibration_cert_extract",
  description:
    "Calibration / test certificate (Trescal and similar ISO-17025 labs). " +
    "Extract every certificate found in the document; a bundle may staple several. " +
    "The header is a TWO-COLUMN layout — read carefully so a label in one column " +
    "is not paired with the value from the other.",
  properties: {
    certificates: {
      type: "array",
      description:
        "Every distinct calibration certificate in the document. Emit one entry per cert.",
      items: {
        type: "object",
        required: ["asset_number", "cal_date", "cal_due"],
        properties: {
          asset_number: {
            type: ["string", "null"],
            description:
              "The 'ASSET NUMBER' field (also printed as 'CMX BARCODE') — the customer's " +
              "asset tag, e.g. 'CXS027014'. This is NOT the serial number.",
          },
          serial_number: {
            type: ["string", "null"],
            description:
              "The 'SERIAL NUMBER' field — the manufacturer's serial, copied verbatim " +
              "including any letter prefix/suffix, e.g. '68470187MV'. If it is absent or " +
              "illegible, return null — do NOT copy the asset number into this field.",
          },
          make: {
            type: ["string", "null"],
            description:
              "Manufacturer / brand of the unit under test, e.g. 'Fluke', 'Megger', 'Kyoritsu'.",
          },
          model: {
            type: ["string", "null"],
            description: "Bare model designation, e.g. '323', 'T6-1000', 'DLRO10HD'.",
          },
          unit_under_test: {
            type: ["string", "null"],
            description:
              "The 'UNIT UNDER TEST' description as printed, e.g. 'Fluke 323 Clamp Meter'.",
          },
          cal_date: {
            type: ["string", "null"],
            description: "The 'CAL DATE' as printed, e.g. '28-Apr-2026'.",
          },
          cal_due: {
            type: ["string", "null"],
            description: "The 'CAL DUE' as printed, e.g. '28-Apr-2027'.",
          },
          test_result: {
            type: ["string", "null"],
            description:
              "The 'TEST RESULT' as printed, e.g. 'PASS', 'FAIL', or 'LIMITED CALIBRATION'. " +
              "Copy it verbatim — do not normalise to just PASS.",
          },
          cert_number: {
            type: ["string", "null"],
            description: "The 'Calibration Certificate Number', e.g. 'S568457-1FL'.",
          },
        },
      },
    },
  },
  required: ["certificates"],
};
