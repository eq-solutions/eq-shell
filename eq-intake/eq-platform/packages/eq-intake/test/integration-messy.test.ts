/**
 * End-to-end integration test against `staff-messy.csv`.
 *
 * Pipes the real-world messy fixture through:
 *   parseFile()  →  identity-style mapping (alias-aware)  →  validate()
 *
 * Then asserts the canonical output every row should produce. This is the
 * test that catches drift between the parser, the coercers, and the staff
 * schema — when one of those changes in a way that breaks a real export's
 * shape, this fails before a customer sees it.
 *
 * Notes on the mapping:
 *  - The `Name` column is split into first_name + last_name via the
 *    split-name transform (this is what the AI mapper would emit when it
 *    sees one Name column and two required fields).
 *  - `Rate` is intentionally NOT mapped — hourly_rate_cost is
 *    x-eq-sensitive, so mapping it flips every row into flagged_rows with
 *    a sensitive_field flag and noises up the assertions. Currency-strip
 *    behaviour is covered by the @eq/validation unit tests.
 *  - `Emp #` lands in `external_id` (the customer's own ID for the staff
 *    member — preserved for round-trip exports).
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "../src/parse-file.js";
import { validate, type TransformSpec } from "@eq/validation";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = join(__dirname, "fixtures", "staff-messy.csv");
const STAFF_SCHEMA_PATH = join(
  __dirname,
  "..",
  "..",
  "eq-schemas",
  "src",
  "schemas",
  "staff.schema.json",
);

const TENANT = "00000000-0000-4000-8000-000000000001";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const E164_AU_MOBILE = /^\+614\d{8}$/;

interface ExpectedRow {
  emp: string;
  first_name: string;
  last_name: string;
  /** E.164 if normalisable. Literal raw string if the phone is junk. */
  phone: string;
  /** "kept_raw" when coerce couldn't normalise — flagged but not rejected. */
  phone_state: "normalised" | "kept_raw";
  employment_type: "employee" | "subcontractor" | "labour_hire" | "casual" | "apprentice";
  start_date: string | "ANY_VALID_ISO";
  trade: string | null;
  /**
   * Set on rows the schema can't currently process cleanly. Documents a
   * known gap rather than testing what the system pretends to do —
   * e.g. apprentice-year strings ("1st Year") aren't in the
   * employment_type enum aliases yet. Adding those aliases is a
   * follow-up schema improvement; this test flags it as known.
   */
  expectRejected?: { field: string; reason: string };
}

const EXPECTED: ExpectedRow[] = [
  // Row 1 — clean baseline. FT → employee, AU phone normalised.
  {
    emp: "E0023",
    first_name: "James",
    last_name: "Patel",
    phone: "+61412345678",
    phone_state: "normalised",
    employment_type: "employee",
    start_date: "2022-03-01",
    trade: "Sparkie",
  },
  // Row 2 — Sarah O'Brien, parens + spaces in mobile, Sub alias.
  {
    emp: "E0024",
    first_name: "Sarah",
    last_name: "O'Brien",
    phone: "+61413555111",
    phone_state: "normalised",
    employment_type: "subcontractor",
    start_date: "2023-06-15",
    trade: "Electrical",
  },
  // Row 3 — Permanent alias for employee, dashes in phone, 12-Sep-21 date.
  {
    emp: "E0025",
    first_name: "Michael",
    last_name: "Henderson",
    phone: "+61414222333",
    phone_state: "normalised",
    employment_type: "employee",
    start_date: "2021-09-12",
    trade: "Mech",
  },
  // Row 4 — Lien Tran. "1st Year" is the conventional apprentice-year
  // notation in trade payroll exports, but it isn't in the schema's
  // employment_type aliases today. This row is rejected with a known-gap
  // reason. Add "1st year" / "2nd year" / "3rd year" / "4th year" to the
  // apprentice aliases when this gap becomes worth closing.
  {
    emp: "E0026",
    first_name: "Lien",
    last_name: "Tran",
    phone: "+61415444222",
    phone_state: "normalised",
    employment_type: "apprentice",
    start_date: "2024-01-22",
    trade: "Electrician",
    expectRejected: {
      field: "employment_type",
      reason: "\"1st Year\" not in apprentice alias list",
    },
  },
  // Row 5 — already E.164, 5-Nov-20 date.
  {
    emp: "E0027",
    first_name: "Kofi",
    last_name: "Asante",
    phone: "+61416777888",
    phone_state: "normalised",
    employment_type: "employee",
    start_date: "2020-11-05",
    trade: "Fire",
  },
  // Row 6 — Agency → labour_hire.
  {
    emp: "E0028",
    first_name: "Zara",
    last_name: "Williams",
    phone: "+61417999000",
    phone_state: "normalised",
    employment_type: "labour_hire",
    start_date: "2025-02-10",
    trade: "Sparkie",
  },
  // Row 7 — "SUBBIE" (uppercase) → subcontractor (case-insensitive alias).
  {
    emp: "E0029",
    first_name: "Daniel",
    last_name: "Quinn",
    phone: "+61418123456",
    phone_state: "normalised",
    employment_type: "subcontractor",
    start_date: "2022-08-30",
    trade: "Hydraulics",
  },
  // Row 8 — Casual, multi-word trade ("Data Comms").
  {
    emp: "E0030",
    first_name: "Aria",
    last_name: "Singh",
    phone: "+61419234567",
    phone_state: "normalised",
    employment_type: "casual",
    start_date: "2024-09-01",
    trade: "Data Comms",
  },
  // Row 9 — Full-Time → employee, parens with no space, four-digit year date.
  {
    emp: "E0031",
    first_name: "Lucas",
    last_name: "Murphy",
    phone: "+61420345678",
    phone_state: "normalised",
    employment_type: "employee",
    start_date: "2019-04-17",
    trade: "Civil",
  },
  // Row 10 — Apprentice direct match, empty trade.
  {
    emp: "E0032",
    first_name: "Maya",
    last_name: "Eriksen",
    phone: "+61421456789",
    phone_state: "normalised",
    employment_type: "apprentice",
    start_date: "2024-07-08",
    trade: null,
  },
  // Row 11 — "no mobile" — un-coercable phone, kept raw + phone_kept_raw flag.
  {
    emp: "E0033",
    first_name: "Tom",
    last_name: "O'Sullivan",
    phone: "no mobile",
    phone_state: "kept_raw",
    employment_type: "employee",
    start_date: "2022-05-05",
    trade: "Sparkie",
  },
  // Row 12 — labour-hire alias, Excel serial date (42867).
  {
    emp: "E0034",
    first_name: "Wei",
    last_name: "Chen",
    phone: "+61422555444",
    phone_state: "normalised",
    employment_type: "labour_hire",
    start_date: "ANY_VALID_ISO", // Excel serial — assert ISO shape, not exact value.
    trade: "Mechanical",
  },
];

describe("staff-messy.csv — full pipeline integration", () => {
  it("parses, maps, validates, and produces canonical rows for every input row", async () => {
    const csvBytes = await readFile(FIXTURE);
    const schemaJson = JSON.parse(await readFile(STAFF_SCHEMA_PATH, "utf-8"));

    // 1. Parse the messy CSV.
    const parseResult = await parseFile({
      bytes: csvBytes,
      fileName: "staff-messy.csv",
    });
    expect(parseResult.format).toBe("csv");
    expect(parseResult.sheets).toHaveLength(1);

    const sheet = parseResult.sheets[0]!;
    expect(sheet.headerRow).toEqual([
      "Emp #",
      "Name",
      "Mob",
      "Type",
      "Started",
      "Rate",
      "Trade",
    ]);
    expect(sheet.rows).toHaveLength(EXPECTED.length);

    // 2. Identity-style mapping — what a mock AI doing alias resolution
    //    against the staff schema would produce.
    const mapping: Record<string, string | null> = {
      "Emp #": "external_id",
      Name: null, // handled by split-name transform → first_name + last_name
      Mob: "phone",
      Type: "employment_type",
      Started: "start_date",
      Rate: null, // sensitive field — intentionally not mapped
      Trade: "trade",
      // The split-name transform writes new first_name/last_name keys into
      // the transformed row; the mapping needs identity entries for those
      // keys so the validate orchestrator picks them up.
      first_name: "first_name",
      last_name: "last_name",
    };
    const transformations: Record<string, TransformSpec> = {
      Name: { kind: "split-name", targets: ["first_name", "last_name"] },
    };

    // 3. Validate.
    const result = await validate({
      schema: schemaJson,
      mapping,
      transformations,
      rows: sheet.rows,
      tenantId: TENANT,
    });

    // 4. Top-level shape.
    expect(result.summary.total).toBe(EXPECTED.length);

    // Known-gap rejections — anything beyond these is a regression.
    const expectedRejectedCount = EXPECTED.filter((e) => e.expectRejected).length;
    if (result.rejected_rows.length !== expectedRejectedCount) {
      // Surface the cause for whoever's reading the failure.
      // eslint-disable-next-line no-console
      console.error("Unexpected rejected rows:", JSON.stringify(result.rejected_rows, null, 2));
    }
    expect(result.summary.rejected).toBe(expectedRejectedCount);

    // Build a unified index of every row's bucket + canonical + flags,
    // so the per-row assertions don't care whether the row landed in
    // valid_rows or flagged_rows.
    type Bucket = "valid" | "flagged" | "rejected";
    interface RowSnapshot {
      bucket: Bucket;
      canonical: Record<string, unknown>;
      flagKinds: string[];
      errorFields: string[];
    }
    const byIndex = new Map<number, RowSnapshot>();
    for (const r of result.valid_rows) {
      byIndex.set(r.source_row_index, {
        bucket: "valid",
        canonical: r.canonical,
        flagKinds: [],
        errorFields: [],
      });
    }
    for (const r of result.flagged_rows) {
      byIndex.set(r.source_row_index, {
        bucket: "flagged",
        canonical: r.canonical,
        flagKinds: r.flags.map((f) => f.kind),
        errorFields: [],
      });
    }
    for (const r of result.rejected_rows) {
      byIndex.set(r.source_row_index, {
        bucket: "rejected",
        canonical: {},
        flagKinds: [],
        errorFields: r.errors.map((e) =>
          "field" in e && typeof e.field === "string" ? e.field : "",
        ),
      });
    }
    expect(byIndex.size).toBe(EXPECTED.length);

    // 5. Per-row assertions.
    for (let i = 0; i < EXPECTED.length; i++) {
      const exp = EXPECTED[i]!;
      const got = byIndex.get(i);
      expect(got, `row ${i + 1} (${exp.first_name} ${exp.last_name}) is missing from result`).toBeDefined();
      if (!got) continue;

      // Known-gap rejection — assert the row was rejected on the expected
      // field, then skip canonical assertions (no canonical exists for
      // rejected rows).
      if (exp.expectRejected) {
        expect(got.bucket, `row ${i + 1} should be rejected`).toBe("rejected");
        expect(
          got.errorFields.includes(exp.expectRejected.field),
          `row ${i + 1} expected rejection on field ${exp.expectRejected.field}, got errors on ${got.errorFields.join(", ")}`,
        ).toBe(true);
        continue;
      }

      // Name split
      expect(got.canonical["first_name"], `row ${i + 1} first_name`).toBe(exp.first_name);
      expect(got.canonical["last_name"], `row ${i + 1} last_name`).toBe(exp.last_name);

      // External ID round-trips verbatim
      expect(got.canonical["external_id"], `row ${i + 1} external_id`).toBe(exp.emp);

      // Employment type — alias resolution to canonical enum
      expect(got.canonical["employment_type"], `row ${i + 1} employment_type`).toBe(
        exp.employment_type,
      );

      // Start date
      if (exp.start_date === "ANY_VALID_ISO") {
        expect(
          String(got.canonical["start_date"]),
          `row ${i + 1} start_date should be ISO`,
        ).toMatch(ISO_DATE);
      } else {
        expect(got.canonical["start_date"], `row ${i + 1} start_date`).toBe(
          exp.start_date,
        );
      }

      // Phone
      if (exp.phone_state === "normalised") {
        expect(
          String(got.canonical["phone"]),
          `row ${i + 1} phone (normalised)`,
        ).toMatch(E164_AU_MOBILE);
        expect(got.canonical["phone"], `row ${i + 1} phone exact`).toBe(exp.phone);
        expect(
          got.flagKinds.includes("phone_kept_raw"),
          `row ${i + 1} should not have phone_kept_raw`,
        ).toBe(false);
      } else {
        // Un-coercable — value preserved as the raw source string and the
        // row is flagged (not rejected).
        expect(got.canonical["phone"], `row ${i + 1} phone (raw)`).toBe(exp.phone);
        expect(got.bucket, `row ${i + 1} should be flagged`).toBe("flagged");
        expect(
          got.flagKinds.includes("phone_kept_raw"),
          `row ${i + 1} must carry phone_kept_raw flag`,
        ).toBe(true);
      }

      // Trade — free text; empty source should land as null/empty
      if (exp.trade === null) {
        const tradeVal = got.canonical["trade"];
        expect(
          tradeVal === null || tradeVal === undefined || tradeVal === "",
          `row ${i + 1} trade should be null/empty, got ${JSON.stringify(tradeVal)}`,
        ).toBe(true);
      } else {
        expect(got.canonical["trade"], `row ${i + 1} trade`).toBe(exp.trade);
      }

      // Active — schema default kicks in for messy imports that don't
      // carry an explicit Active column.
      expect(got.canonical["active"], `row ${i + 1} active default`).toBe(true);
    }

    // 6. Spot-check that Tom (row 11, index 10) is the ONLY phone_kept_raw row.
    const phoneRawCount = [...byIndex.values()].filter((b) =>
      b.flagKinds.includes("phone_kept_raw"),
    ).length;
    expect(phoneRawCount).toBe(1);

    // 7. Every row not flagged as a known-gap rejection should be valid or
    //    flagged — never rejected. If a previously-clean row starts getting
    //    rejected, something in the parser, the schema, or a coercer has
    //    regressed against real-world messy input.
    const unexpectedRejects = result.rejected_rows.filter(
      (r) => !EXPECTED[r.source_row_index]?.expectRejected,
    );
    expect(
      unexpectedRejects,
      `unexpected rejections: ${JSON.stringify(unexpectedRejects, null, 2)}`,
    ).toEqual([]);
  });
});
