/**
 * Task 5 acceptance — born-digital PDF asset register → assets.
 *
 * A real (hand-built) born-digital PDF equipment schedule flows through the
 * same parse → map → validate → commit path as CSV. Each table row becomes a
 * draft asset.
 *
 * The PDF is generated inline: one text-show per row with multi-space cell
 * separators, which is exactly the shape the PDF reader's multi-space table
 * detection locks onto.
 */

import { describe, it, expect } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import type { AIProvider, MapInput, MapResult } from "@eq/ai";
import { ASSET_SCHEMA } from "./fixtures/asset-schema.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

function metrics() {
  return { provider: "mock", model: "mock", tokensIn: 0, tokensOut: 0, latencyMs: 0, success: true, retried: false, startedAt: new Date().toISOString() };
}

function identityAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      return {
        mappings: input.sourceColumns.map((c) => ({ sourceColumn: c, canonicalField: c, confidence: 1, reason: "identity" })),
        unmappedRequiredFields: [],
        warnings: [],
        suggestions: [],
        needsClarification: [],
        metrics: metrics(),
      };
    },
    async extract() {
      throw new Error("not used");
    },
  };
}

/**
 * Minimal single-page born-digital PDF. Each cell is its own text-show at a
 * distinct X (1 0 0 1 x y Tm), which is how real tabular PDFs lay out columns
 * — and what the position-aware reader clusters back into a grid.
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
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

describe("PDF register flow — task 5", () => {
  it("imports a tabular born-digital PDF register through the confirm flow", async () => {
    const pdf = makeTablePdf([
      ["external_id", "name", "make", "serial_number"],
      ["MSB-1", "Main Switchboard", "Schneider", "SN-1"],
      ["UPS-1", "UPS Room A", "Eaton", "SN-2"],
      ["GEN-1", "Generator", "Cummins", "SN-3"],
    ]);

    const committed: { rows: { canonical: Record<string, unknown> }[] } = { rows: [] };
    const flow = createConfirmFlow();
    const config: FlowConfig = {
      schema: ASSET_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      enableEnrichment: false,
      commit: async (rows) => {
        committed.rows = rows as { canonical: Record<string, unknown> }[];
        return { committed: rows.length, failed: 0 };
      },
    };
    flow.driver.configure(config);

    await flow.driver.runToConfirmMapping({ name: "register.pdf", bytes: pdf });

    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("confirm_mapping");
    expect(state.parsedSheet!.headerRow).toEqual(["external_id", "name", "make", "serial_number"]);
    expect(state.parsedSheet!.rows).toHaveLength(3);

    await flow.driver.validate();
    const result = flow.useStore.getState().validationResult!;
    expect(result.summary.rejected).toBe(0);
    expect(result.valid_rows.length + result.flagged_rows.length).toBe(3);

    await flow.driver.commit();
    expect(committed.rows).toHaveLength(3);
    expect(committed.rows.map((r) => r.canonical.name)).toEqual([
      "Main Switchboard",
      "UPS Room A",
      "Generator",
    ]);
  });
});
