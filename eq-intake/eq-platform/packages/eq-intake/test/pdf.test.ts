/**
 * PDF reader — layout detection tests.
 *
 * The byte-level PDF parsing lives in unpdf (already tested upstream). What's
 * worth testing here is the layout-detection logic that turns extracted text
 * into a ParsedSheet. We exercise `_parsePageTextForTest` directly with
 * canned page-text inputs.
 */

import { describe, it, expect } from "vitest";
import { _parsePageTextForTest, parsePdf } from "../src/readers/pdf.js";

/**
 * Minimal born-digital PDF with each cell at its own X position — the layout
 * the position-aware reader clusters back into a grid. (unpdf's plain text
 * extraction collapses whitespace, so coordinates are the only reliable signal.)
 */
function makeTablePdf(rows: string[][], xcols = [72, 230, 380, 480]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let content = "BT\n/F1 10 Tf\n";
  let y = 720;
  for (const row of rows) {
    row.forEach((cell, i) => {
      content += `1 0 0 1 ${xcols[i]} ${y} Tm\n(${esc(cell)}) Tj\n`;
    });
    y -= 18;
  }
  content += "ET";
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    5: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  };
  let pdf = "%PDF-1.4\n";
  const off: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    off[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xs = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xs}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("PDF position-aware table detection", () => {
  it("reads a born-digital table off the page via text-item coordinates", async () => {
    const bytes = makeTablePdf([
      ["external_id", "name", "make", "serial_number"],
      ["MSB-1", "Main Switchboard", "Schneider", "SN-1"],
      ["UPS-1", "UPS Room A", "Eaton", "SN-2"],
      ["GEN-1", "Generator", "Cummins", "SN-3"],
    ]);
    const result = await parsePdf(bytes);
    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0]!;
    expect(sheet.layout).toBe("tabular");
    expect(sheet.headerRow).toEqual(["external_id", "name", "make", "serial_number"]);
    expect(sheet.rows).toHaveLength(3);
    // Cells with internal spaces stay intact (not split into two columns).
    expect(sheet.rows[0]).toMatchObject({
      external_id: "MSB-1",
      name: "Main Switchboard",
      make: "Schneider",
      serial_number: "SN-1",
    });
  });
});

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
