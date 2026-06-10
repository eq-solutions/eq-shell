/**
 * Extraction-time JSON Schema for the AI vision prompt.
 *
 * Wraps a Maximo WO record schema in `{ work_orders: [...] }` so a single
 * PDF (which may contain multiple stapled WOs) returns an array in one
 * round-trip. The existing `AIProvider.extract` returns a single record;
 * the skill unwraps `extracted.work_orders` after the call.
 *
 * This is NOT a canonical entity schema. It exists only to shape the
 * vision prompt. Canonical mapping is done by `to-canonical.ts`.
 */
export const MAXIMO_WO_EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  "x-eq-entity": "maximo_wo_extract",
  description:
    "IBM Maximo work-order PDF — extract every WO header table found in the document. " +
    "Each PDF may contain 1-N stapled WOs; emit one record per WO.",
  properties: {
    work_orders: {
      type: "array",
      description:
        "Every distinct Maximo work order found in the document. " +
        "Look for the header table that starts with WO# (a 7-digit number) " +
        "and continues with Site / Asset / Status / Work Type / Priority / Job Plan / " +
        "Target Start / Target Finish / Classification fields. " +
        "If the PDF contains more than one stapled WO, emit one array entry per WO.",
      items: {
        type: "object",
        required: ["wo_number", "site", "asset", "job_plan"],
        properties: {
          wo_number: {
            type: "string",
            description: "7-digit Maximo WO number from the top of the header table (e.g. '4501310').",
          },
          site: {
            type: "string",
            description: "Site code as printed, e.g. 'AU01-CA1'.",
          },
          asset: {
            type: "string",
            description:
              "Asset row exactly as printed. Two known shapes: " +
              "'1070 — CA1-TS-AC-29-ATS' (numeric Maximo ID + descriptive name) " +
              "or 'CA1-PTP - CA1-Comprehensive Utility Failure Test (PTP)' (no leading ID).",
          },
          serial_number: {
            type: ["string", "null"],
            description: "Serial #. Often 'N/A'.",
          },
          status: {
            type: ["string", "null"],
            description: "Maximo status code, e.g. 'INPRG', 'WAPPROV', 'COMP'.",
          },
          location: {
            type: ["string", "null"],
            description: "Sub-location within site, e.g. 'CA1-GF-22 - CA1-GF-Node Room'.",
          },
          work_type: {
            type: ["string", "null"],
            description: "Maximo work type: 'PM', 'CM', 'EM', 'CAL', 'INSP'.",
          },
          priority: {
            type: ["string", "number", "null"],
            description: "Maximo priority integer 1-4.",
          },
          job_plan: {
            type: "string",
            description:
              "Job plan as printed, e.g. 'ATS-3 - E1.8 ATS-Automatic Transfer Switches'.",
          },
          crew_id: {
            type: ["string", "null"],
            description: "Crew identifier — usually blank.",
          },
          target_start: {
            type: ["string", "null"],
            description: "Target start date as printed, e.g. '20-May-2026'.",
          },
          target_finish: {
            type: ["string", "null"],
            description: "Target finish date as printed, e.g. '20-May-2026'.",
          },
          actual_start: {
            type: ["string", "null"],
            description: "Actual start — blank until completed.",
          },
          actual_finish: {
            type: ["string", "null"],
            description: "Actual finish — blank until completed.",
          },
          classification: {
            type: ["string", "null"],
            description: "Asset classification e.g. 'ATS-Auto Transfer Switch'.",
          },
          failure_code: { type: ["string", "null"] },
          problem: { type: ["string", "null"] },
          cause: { type: ["string", "null"] },
          remedy: { type: ["string", "null"] },
          ir_scan_result: {
            type: ["string", "null"],
            description: "IR scan tick-box result — usually blank when scheduling.",
          },
        },
      },
    },
  },
  required: ["work_orders"],
};
