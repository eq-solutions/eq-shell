/**
 * PDF reader — layout detection tests.
 *
 * The byte-level PDF parsing lives in unpdf (already tested upstream). What's
 * worth testing here is the layout-detection logic that turns extracted text
 * into a ParsedSheet. We exercise `_parsePageTextForTest` directly with
 * canned page-text inputs.
 */

import { describe, it, expect } from "vitest";
import { _parsePageTextForTest } from "../src/readers/pdf.js";

describe("PDF layout — tab-delimited", () => {
  it("detects a tab-delimited table from a born-digital PDF", () => {
    const text =
      "first_name\tlast_name\temployment_type\n" +
      "James\tPatel\temployee\n" +
      "Sarah\tO'Brien\tsubcontractor\n" +
      "Lien\tTran\tapprentice\n";
    const page = _parsePageTextForTest(text);
    expect(page.layout).toBe("tabular");
    expect(page.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
    ]);
    expect(page.rows).toHaveLength(3);
    expect(page.rows[0]).toMatchObject({
      first_name: "James",
      last_name: "Patel",
      employment_type: "employee",
    });
  });
});

describe("PDF layout — multi-space-delimited", () => {
  it("detects a multi-space table (CSV pasted into PDF)", () => {
    const text =
      "first_name    last_name    employment_type\n" +
      "James         Patel        employee\n" +
      "Sarah         O'Brien      subcontractor\n" +
      "Lien          Tran         apprentice\n";
    const page = _parsePageTextForTest(text);
    expect(page.layout).toBe("tabular");
    expect(page.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
    ]);
    expect(page.rows).toHaveLength(3);
  });
});

describe("PDF layout — raw_text fallback", () => {
  it("returns raw_text when no consistent table shape is detected", () => {
    const text =
      "This is a paragraph of prose without any tabular structure.\n" +
      "It has many words but no consistent column boundaries that\n" +
      "the heuristic could lock onto.\n";
    const page = _parsePageTextForTest(text);
    expect(page.layout).toBe("raw_text");
    expect(page.headerRow).toEqual(["raw_text"]);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      raw_text: expect.stringContaining("paragraph of prose"),
    });
  });

  it("returns raw_text when there aren't enough rows for a table", () => {
    const text = "header_a\theader_b\nonly\trow\n";
    const page = _parsePageTextForTest(text, "auto", 3);
    expect(page.layout).toBe("raw_text");
  });

  it("respects layout='raw_text' override even on otherwise-tabular text", () => {
    const text =
      "a\tb\n" +
      "1\t2\n" +
      "3\t4\n" +
      "5\t6\n";
    const page = _parsePageTextForTest(text, "raw_text");
    expect(page.layout).toBe("raw_text");
    expect(page.headerRow).toEqual(["raw_text"]);
  });
});

describe("PDF layout — edge cases", () => {
  it("normalises blank header cells to col_N", () => {
    const text = "first_name\t\tlast_name\nJames\tx\tPatel\nSarah\ty\tO'Brien\nLien\tz\tTran\n";
    const page = _parsePageTextForTest(text);
    expect(page.layout).toBe("tabular");
    expect(page.headerRow).toEqual(["first_name", "col_2", "last_name"]);
  });

  it("tolerates row length off-by-one (common trailing-empty quirk)", () => {
    const text =
      "a\tb\tc\n" +
      "1\t2\t3\n" +
      "4\t5\n" + // one short — counted toward consistency
      "7\t8\t9\n";
    const page = _parsePageTextForTest(text);
    expect(page.layout).toBe("tabular");
    expect(page.rows).toHaveLength(3);
  });
});
