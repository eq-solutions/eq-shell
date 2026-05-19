/**
 * XLSX reader tests.
 *
 * Builds the test workbooks programmatically with SheetJS so we don't have to
 * commit binary fixtures. Three scenarios:
 *   1. Clean single-sheet workbook → all rows parse, headers detected at row 0
 *   2. Multi-sheet workbook → each sheet returned in order
 *   3. Workbook with a title row + blank row above the headers → header
 *      auto-detect picks the right row
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx } from "../src/readers/xlsx.js";
import { validate } from "@eq/validation";

/** Build an XLSX buffer from an array-of-arrays. */
function buildXlsx(sheets: Array<{ name: string; rows: unknown[][]; hidden?: boolean }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  if (sheets.some((s) => s.hidden)) {
    wb.Workbook = wb.Workbook ?? { Sheets: [] };
    wb.Workbook.Sheets = sheets.map((s) => ({
      name: s.name,
      Hidden: s.hidden ? 1 : 0,
    }));
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("parseXlsx — clean single-sheet workbook", () => {
  it("parses headers and rows from row 0", async () => {
    const buf = buildXlsx([
      {
        name: "Staff",
        rows: [
          ["first_name", "last_name", "employment_type", "active"],
          ["James", "Patel", "employee", true],
          ["Sarah", "O'Brien", "subcontractor", true],
          ["Lien", "Tran", "apprentice", true],
        ],
      },
    ]);

    const wb = await parseXlsx(buf);

    expect(wb.sheets).toHaveLength(1);
    expect(wb.meta.totalSheets).toBe(1);
    expect(wb.meta.returnedSheets).toBe(1);
    expect(wb.meta.format).toBe("xlsx");

    const sheet = wb.sheets[0]!;
    expect(sheet.sheetName).toBe("Staff");
    expect(sheet.headerRowIndex).toBe(0);
    expect(sheet.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
      "active",
    ]);
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.rows[0]).toMatchObject({
      first_name: "James",
      last_name: "Patel",
      employment_type: "employee",
      active: true,
    });
  });
});

describe("parseXlsx — multi-sheet workbook", () => {
  it("returns one ParsedSheet per worksheet in workbook order", async () => {
    const buf = buildXlsx([
      {
        name: "Staff",
        rows: [
          ["first_name", "last_name"],
          ["James", "Patel"],
        ],
      },
      {
        name: "Sites",
        rows: [
          ["name", "code"],
          ["Equinix SY3", "SY3"],
          ["NEXTDC S2", "S2"],
        ],
      },
    ]);

    const wb = await parseXlsx(buf);

    expect(wb.sheets).toHaveLength(2);
    expect(wb.sheets.map((s) => s.sheetName)).toEqual(["Staff", "Sites"]);
    expect(wb.sheets[0]!.rows).toHaveLength(1);
    expect(wb.sheets[1]!.rows).toHaveLength(2);
    expect(wb.sheets[1]!.rows[0]).toMatchObject({
      name: "Equinix SY3",
      code: "SY3",
    });
  });

  it("filters by sheetName when supplied", async () => {
    const buf = buildXlsx([
      { name: "Staff", rows: [["a"], ["1"]] },
      { name: "Sites", rows: [["b"], ["2"]] },
    ]);
    const wb = await parseXlsx(buf, { sheetName: "Sites" });
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]!.sheetName).toBe("Sites");
  });
});

describe("parseXlsx — auto-detects header row past title rows", () => {
  it("skips title + blank row and picks the real header row", async () => {
    const buf = buildXlsx([
      {
        name: "Staff Export 2026",
        rows: [
          ["My Company Staff Export — 12 May 2026"], // title row, 1 cell
          [], // blank row
          ["first_name", "last_name", "employment_type"], // real header (row 2)
          ["James", "Patel", "employee"],
          ["Sarah", "O'Brien", "subcontractor"],
        ],
      },
    ]);

    const wb = await parseXlsx(buf);
    const sheet = wb.sheets[0]!;
    expect(sheet.headerRowIndex).toBe(2);
    expect(sheet.headerRow).toEqual(["first_name", "last_name", "employment_type"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({
      first_name: "James",
      last_name: "Patel",
      employment_type: "employee",
    });
  });
});

describe("parseXlsx — hidden sheets", () => {
  it("skips hidden sheets by default", async () => {
    const buf = buildXlsx([
      { name: "Public", rows: [["a"], ["1"]] },
      { name: "Secret", rows: [["b"], ["2"]], hidden: true },
    ]);
    const wb = await parseXlsx(buf);
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]!.sheetName).toBe("Public");
  });

  it("includes hidden sheets when includeHidden:true", async () => {
    const buf = buildXlsx([
      { name: "Public", rows: [["a"], ["1"]] },
      { name: "Secret", rows: [["b"], ["2"]], hidden: true },
    ]);
    const wb = await parseXlsx(buf, { includeHidden: true });
    expect(wb.sheets).toHaveLength(2);
  });
});

describe("parseXlsx → @eq/validation smoke test", () => {
  it("produces rows that validate() accepts as canonical staff data", async () => {
    const buf = buildXlsx([
      {
        name: "Staff",
        rows: [
          ["first_name", "last_name", "employment_type", "active"],
          ["James", "Patel", "employee", true],
          ["Sarah", "O'Brien", "subcontractor", true],
        ],
      },
    ]);

    const wb = await parseXlsx(buf);
    const sheet = wb.sheets[0]!;

    const PERMISSIVE_STAFF_SCHEMA = {
      $id: "https://schemas.eq.solutions/test/staff-minimal.json",
      type: "object",
      "x-eq-entity": "staff",
      properties: {
        first_name: { type: "string", maxLength: 100 },
        last_name: { type: "string", maxLength: 100 },
        employment_type: {
          type: "string",
          enum: ["employee", "subcontractor", "apprentice", "labour_hire", "casual"],
        },
        active: { type: "boolean", "x-eq-coerce": "boolean" },
      },
      required: ["first_name", "last_name", "employment_type", "active"],
    };

    const mapping: Record<string, string | null> = {};
    for (const col of sheet.headerRow) mapping[col] = col;

    const result = await validate({
      schema: PERMISSIVE_STAFF_SCHEMA,
      mapping,
      rows: sheet.rows,
      tenantId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.summary.total).toBe(2);
    expect(result.summary.valid).toBe(2);
    expect(result.summary.rejected).toBe(0);
  });
});
