/**
 * CSV reader — first end-to-end test.
 *
 * Asserts:
 *   1. parseCsv reads the staff-clean.csv fixture into the expected shape
 *   2. The output is consumable by @eq/validation (no throw, summary populated)
 *
 * The second assertion is deliberately weak — it doesn't claim "all rows
 * valid" because the staff JSON Schema requires staff_id / tenant_id which
 * are intentionally absent from the fixture (those are server-assigned at
 * commit time). The point of the test is to prove the parser produces row
 * objects the validation engine can consume.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "../src/readers/csv.js";
import { validate } from "@eq/validation";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures");

// Minimal inline schema for the validate() smoke check. We don't import the
// real staff schema here because the canonical schema requires fields that
// aren't in a clean import CSV. The point of the test is the parser.
const PERMISSIVE_STAFF_SCHEMA = {
  $id: "https://schemas.eq.solutions/test/staff-minimal.json",
  type: "object",
  "x-eq-entity": "staff",
  properties: {
    first_name: { type: "string", maxLength: 100 },
    last_name: { type: "string", maxLength: 100 },
    email: { type: "string", format: "email" },
    phone: { type: "string", "x-eq-coerce": "phone-au" },
    employment_type: {
      type: "string",
      enum: [
        "employee",
        "subcontractor",
        "apprentice",
        "labour_hire",
        "casual",
      ],
    },
    trade: { type: "string" },
    start_date: { type: "string", format: "date" },
    active: { type: "boolean", "x-eq-coerce": "boolean" },
  },
  required: ["first_name", "last_name", "employment_type", "active"],
};

describe("parseCsv — staff-clean.csv", () => {
  it("parses 10 rows with the correct headers", async () => {
    const raw = readFileSync(join(FIXTURE_DIR, "staff-clean.csv"));
    const parsed = await parseCsv(raw);

    expect(parsed.rows).toHaveLength(10);
    expect(parsed.headerRow).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
      "employment_type",
      "trade",
      "start_date",
      "active",
    ]);
    expect(parsed.meta.delimiter).toBe(",");
    expect(parsed.meta.totalRows).toBe(10);
    expect(parsed.meta.malformedRows).toBe(0);
  });

  it("reads James Patel as the first row with the right field values", async () => {
    const raw = readFileSync(join(FIXTURE_DIR, "staff-clean.csv"));
    const parsed = await parseCsv(raw);

    const firstRow = parsed.rows[0];
    expect(firstRow).toBeDefined();
    expect(firstRow).toMatchObject({
      first_name: "James",
      last_name: "Patel",
      email: "james.patel@example.com.au",
      phone: "+61412345678",
      employment_type: "employee",
      trade: "electrical",
      start_date: "2022-03-01",
      active: "true",
    });
  });

  it("accepts a string input directly (not just Buffer)", async () => {
    const text = readFileSync(join(FIXTURE_DIR, "staff-clean.csv"), "utf-8");
    const parsed = await parseCsv(text);
    expect(parsed.rows).toHaveLength(10);
  });

  it("strips a UTF-8 BOM if present", async () => {
    const withBom = "﻿first_name,last_name\nJohn,Smith\n";
    const parsed = await parseCsv(withBom);
    expect(parsed.headerRow).toEqual(["first_name", "last_name"]);
    expect(parsed.rows[0]).toMatchObject({
      first_name: "John",
      last_name: "Smith",
    });
    expect(parsed.meta.bomDetected).toBe(true);
  });

  it("auto-detects a semicolon delimiter", async () => {
    const semi = "first_name;last_name\nJohn;Smith\nSarah;O'Brien\n";
    const parsed = await parseCsv(semi);
    expect(parsed.meta.delimiter).toBe(";");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({
      first_name: "Sarah",
      last_name: "O'Brien",
    });
  });
});

describe("parseCsv — malformed handling (added 2026-05-19 after overnight review)", () => {
  it("rejects rows with unquoted currency commas instead of silently corrupting them", async () => {
    // Pre-fix: `-$1,234.56` was split into amount="-$1" + __parsed_extra=["234.56"]
    // and the row showed up in `rows` looking valid. Now rejected with reason.
    // `($789)` is a valid 1-cell row for the 1-column header — it passes through.
    const input = "amount\n-$1,234.56\n($789)\n";
    const parsed = await parseCsv(input);
    expect(parsed.rows).toEqual([{ amount: "($789)" }]);
    expect(parsed.meta.malformedRows).toBe(1);
    expect(parsed.meta.malformed[0]?.reason).toBe("extra_fields");
    expect(parsed.meta.malformed[0]?.raw).toBe("-$1,234.56");
    expect(parsed.meta.malformed[0]?.lineNumber).toBe(2);
  });

  it("surfaces line number + raw text for missing-field rows", async () => {
    const input = "a,b,c\n1,2,3\n4,5\n6,7,8\n";
    const parsed = await parseCsv(input);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.meta.malformed).toHaveLength(1);
    expect(parsed.meta.malformed[0]?.lineNumber).toBe(3);
    expect(parsed.meta.malformed[0]?.raw).toBe("4,5");
    expect(parsed.meta.malformed[0]?.reason).toBe("missing_fields");
  });

  it("returned rows never carry __parsed_extra (defensive cleanup)", async () => {
    const input = "a,b\n1,2,3,4\n5,6\n";
    const parsed = await parseCsv(input);
    for (const row of parsed.rows) {
      expect(Object.prototype.hasOwnProperty.call(row, "__parsed_extra")).toBe(false);
    }
  });

  it("clean input has empty malformed[]", async () => {
    const parsed = await parseCsv("a,b\n1,2\n3,4\n");
    expect(parsed.meta.malformed).toHaveLength(0);
    expect(parsed.meta.malformedRows).toBe(0);
    expect(parsed.rows).toHaveLength(2);
  });
});

describe("parseCsv → @eq/validation smoke test", () => {
  it("produces rows that @eq/validation can consume without throwing", async () => {
    const raw = readFileSync(join(FIXTURE_DIR, "staff-clean.csv"));
    const parsed = await parseCsv(raw);

    // Identity mapping: CSV column names already match canonical fields
    const mapping: Record<string, string | null> = {};
    for (const col of parsed.headerRow) {
      mapping[col] = col;
    }

    const result = await validate({
      schema: PERMISSIVE_STAFF_SCHEMA,
      mapping,
      rows: parsed.rows,
      tenantId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.summary.total).toBe(10);
    // With a clean fixture and a permissive schema we expect all 10 rows valid.
    expect(result.summary.valid).toBe(10);
    expect(result.summary.rejected).toBe(0);
  });
});
