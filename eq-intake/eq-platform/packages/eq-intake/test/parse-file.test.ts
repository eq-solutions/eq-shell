/**
 * parseFile orchestrator tests.
 *
 * Verifies format detection (extension + magic bytes + explicit override)
 * and routing to the correct reader. The actual reader behaviour is tested
 * in csv.test.ts / xlsx.test.ts / pdf.test.ts / photo.test.ts.
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseFile } from "../src/parse-file.js";
import type { AIProvider, ExtractResult, MapResult } from "@eq/ai";

function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function xlsxBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["a", "b"],
    [1, 2],
    [3, 4],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

const SIMPLE_CSV = "first_name,last_name\nJames,Patel\nSarah,O'Brien\n";

describe("parseFile — format detection", () => {
  it("routes a .csv file to the CSV reader by extension", async () => {
    const result = await parseFile({
      bytes: csvBytes(SIMPLE_CSV),
      fileName: "staff.csv",
    });
    expect(result.format).toBe("csv");
    expect(result.meta.detectedFrom).toBe("extension");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.rows).toHaveLength(2);
  });

  it("routes an .xlsx file to the XLSX reader by extension", async () => {
    const result = await parseFile({
      bytes: xlsxBytes(),
      fileName: "data.xlsx",
    });
    expect(result.format).toBe("xlsx");
    expect(result.meta.detectedFrom).toBe("extension");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.rows).toHaveLength(2);
  });

  it("detects XLSX by magic bytes when name is unknown", async () => {
    const result = await parseFile({ bytes: xlsxBytes() });
    expect(result.format).toBe("xlsx");
    expect(result.meta.detectedFrom).toBe("magic_bytes");
  });

  it("detects CSV-ish content by printable-byte ratio", async () => {
    const result = await parseFile({ bytes: csvBytes(SIMPLE_CSV) });
    expect(result.format).toBe("csv");
    expect(result.meta.detectedFrom).toBe("magic_bytes");
  });

  it("honours the explicit format override", async () => {
    const result = await parseFile({
      bytes: csvBytes(SIMPLE_CSV),
      fileName: "looks-like-xlsx.xlsx",
      format: "csv",
    });
    expect(result.format).toBe("csv");
    expect(result.meta.detectedFrom).toBe("explicit");
  });
});

describe("parseFile — image route requires AI", () => {
  function mockExtractAi(): AIProvider {
    return {
      async extract(): Promise<ExtractResult> {
        return {
          extracted: { first_name: "James" },
          fieldConfidence: { first_name: 0.95 },
          rawText: "James Patel",
          uncertainFields: [],
          illegibleRegions: [],
          warnings: [],
          metadata: {
            estimatedPages: 1,
            estimatedCaptureMethod: "photo",
            appearsSigned: false,
            appearsComplete: true,
          },
          metrics: {
            provider: "mock",
            model: "mock",
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: 0,
            success: true,
            retried: false,
            startedAt: new Date().toISOString(),
          },
        };
      },
      async map(): Promise<MapResult> {
        throw new Error("not used");
      },
    };
  }

  it("throws if image bytes are supplied without an AI provider", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(
      parseFile({ bytes: jpegBytes, fileName: "photo.jpg" }),
    ).rejects.toThrow(/AIProvider/i);
  });

  it("throws if image bytes are supplied without a visionTargetSchema", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(
      parseFile(
        { bytes: jpegBytes, fileName: "photo.jpg" },
        { ai: mockExtractAi() },
      ),
    ).rejects.toThrow(/visionTargetSchema/i);
  });

  it("routes images through the photo reader when AI + schema supplied", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await parseFile(
      { bytes: jpegBytes, fileName: "photo.jpg" },
      {
        ai: mockExtractAi(),
        visionTargetSchema: {
          type: "object",
          properties: { first_name: { type: "string" } },
        },
      },
    );
    expect(result.format).toBe("image");
    expect(result.sheets[0]!.rows[0]).toMatchObject({ first_name: "James" });
  });
});

describe("parseFile — unknown content fallback", () => {
  it("falls through to a CSV attempt when no magic / extension matches", async () => {
    // Random binary bytes — neither CSV-shaped nor a recognised magic.
    // The fallback runs parseCsv (which doesn't throw on garbage; it returns
    // an empty / single-cell parse) and reports detectedFrom: 'fallback'.
    const random = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe]);
    const result = await parseFile({ bytes: random });
    expect(result.meta.detectedFrom).toBe("fallback");
    // Result is content-shape garbage; the caller is expected to inspect
    // headerRow / rows and decide whether the file was usable.
    expect(result.sheets).toBeDefined();
  });
});
