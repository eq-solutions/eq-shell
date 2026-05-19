/**
 * Confirm-flow state machine — end-to-end integration test.
 *
 * Exercises the full pipeline (parse → map → validate → commit) without React.
 * Uses an in-memory CSV, a mock AIProvider, and a mock commit function.
 */

import { describe, it, expect } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import * as XLSX from "xlsx";
import type {
  AIProvider,
  MapResult,
  ExtractResult,
  MapInput,
  ExtractInput,
} from "@eq/ai";

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
      enum: ["employee", "subcontractor", "apprentice", "labour_hire", "casual"],
    },
    trade: { type: "string" },
    start_date: { type: "string", format: "date" },
    active: { type: "boolean", "x-eq-coerce": "boolean", default: true },
  },
  required: ["first_name", "last_name", "employment_type", "active"],
};

const CSV =
  "first_name,last_name,email,phone,employment_type,trade,start_date,active\n" +
  "James,Patel,james.patel@example.com.au,+61412345678,employee,electrical,2022-03-01,true\n" +
  "Sarah,O'Brien,sarah.obrien@example.com.au,+61413555111,subcontractor,electrical,2023-06-15,true\n" +
  "Michael,Henderson,m.henderson@example.com.au,+61414222333,employee,mechanical,2021-09-12,true\n";

function csvFile(): { name: string; bytes: Uint8Array } {
  return { name: "staff.csv", bytes: new TextEncoder().encode(CSV) };
}

/** Mock AI that maps every source column to itself (identity mapping). */
function identityAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      return {
        mappings: input.sourceColumns.map((c) => ({
          sourceColumn: c,
          canonicalField: c,
          confidence: 0.95,
          reason: "identity (test mock)",
        })),
        unmappedRequiredFields: [],
        warnings: [],
        suggestions: [],
        needsClarification: [],
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
    async extract(): Promise<ExtractResult> {
      throw new Error("not used");
    },
  };
}

const TENANT = "00000000-0000-4000-8000-000000000001";

describe("createConfirmFlow — full pipeline", () => {
  it("transitions idle → parsing → … → complete with a clean CSV", async () => {
    const flow = createConfirmFlow();
    const transitions: string[] = [];

    // Record every status change
    flow.useStore.subscribe((s) => {
      transitions.push(s.status.kind);
    });

    let committedRows: unknown[] = [];
    const config: FlowConfig = {
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async (rows) => {
        committedRows = rows;
        return { committed: rows.length, failed: 0 };
      },
    };

    flow.driver.configure(config);
    await flow.driver.runToConfirmMapping(csvFile());

    expect(flow.useStore.getState().status.kind).toBe("confirm_mapping");
    expect(flow.useStore.getState().parsedSheet?.rows).toHaveLength(3);

    await flow.driver.validate();
    const afterValidate = flow.useStore.getState();
    expect(afterValidate.status.kind).toBe("confirm_rows");
    expect(afterValidate.validationResult?.summary.valid).toBe(3);

    await flow.driver.commit();
    const final = flow.useStore.getState().status;
    expect(final.kind).toBe("complete");
    if (final.kind === "complete") {
      expect(final.committed).toBe(3);
    }
    expect(committedRows).toHaveLength(3);

    expect(transitions).toContain("parsing");
    expect(transitions).toContain("mapping");
    expect(transitions).toContain("confirm_mapping");
    expect(transitions).toContain("validating");
    expect(transitions).toContain("confirm_rows");
    expect(transitions).toContain("committing");
    expect(transitions).toContain("complete");
  });

  it("preserves user overrides over AI mapping", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });
    await flow.driver.runToConfirmMapping(csvFile());

    // User decides not to import 'email'
    flow.useStore.getState().setUserOverride("email", null);

    await flow.driver.validate();
    const result = flow.useStore.getState().validationResult!;
    expect(result.valid_rows).toHaveLength(3);
    for (const r of result.valid_rows) {
      expect(r.canonical["email"]).toBeUndefined();
    }
  });

  it("falls into error state when commit throws", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => {
        throw new Error("Supabase RPC failed");
      },
    });
    await flow.driver.runToConfirmMapping(csvFile());
    await flow.driver.validate();

    await expect(flow.driver.commit()).rejects.toThrow(/Supabase/);
    const status = flow.useStore.getState().status;
    expect(status.kind).toBe("error");
    if (status.kind === "error") {
      expect(status.phase).toBe("committing");
    }
  });

  it("reset() clears all state back to idle", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });
    await flow.driver.runToConfirmMapping(csvFile());
    expect(flow.useStore.getState().parsedSheet).toBeDefined();

    flow.useStore.getState().reset();
    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("idle");
    expect(state.parsedSheet).toBeUndefined();
    expect(state.aiMapping).toBeUndefined();
    expect(state.userOverrides).toEqual({});
    expect(state.resolutions).toEqual({});
  });

  it("works without an AI provider (manual mapping path)", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      // no ai
      commit: async (rows) => ({ committed: rows.length, failed: 0 }),
    });

    await flow.driver.parse(csvFile());
    await flow.driver.classify();
    await flow.driver.map();
    expect(flow.useStore.getState().status.kind).toBe("confirm_mapping");
    expect(flow.useStore.getState().aiMapping).toBeUndefined();

    // Manual mapping
    for (const col of flow.useStore.getState().parsedSheet!.headerRow) {
      flow.useStore.getState().setUserOverride(col, col);
    }

    await flow.driver.validate();
    expect(flow.useStore.getState().validationResult?.summary.valid).toBe(3);
  });
});

describe("createConfirmFlow — File / Blob input regression", () => {
  // Regression for the bug where `"bytes" in file` was used as a discriminator.
  // Browser File/Blob have a `bytes()` METHOD, so the check passed and the
  // method reference was decoded as raw bytes, producing zero columns.
  it("reads bytes from an object that has a Blob-style bytes() method", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    const csvBytes = new TextEncoder().encode(CSV);
    // Construct a File-like object: has both bytes() method (the trap) AND
    // arrayBuffer() (the correct path the driver should use).
    const blobLike = {
      name: "staff.csv",
      bytes: async () => csvBytes, // <-- the method trap
      arrayBuffer: async () => csvBytes.buffer.slice(
        csvBytes.byteOffset,
        csvBytes.byteOffset + csvBytes.byteLength,
      ) as ArrayBuffer,
    };

    await flow.driver.runToConfirmMapping(blobLike as unknown as File);

    const parsed = flow.useStore.getState().parsedSheet;
    expect(parsed).toBeDefined();
    expect(parsed!.headerRow).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
      "employment_type",
      "trade",
      "start_date",
      "active",
    ]);
    expect(parsed!.rows).toHaveLength(3);
  });
});

describe("createConfirmFlow — XLSX / image format routing", () => {
  it("parses an XLSX file dropped through the same driver as CSV", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    // Build an XLSX in-memory
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["first_name", "last_name", "employment_type", "active"],
      ["James", "Patel", "employee", true],
      ["Sarah", "O'Brien", "subcontractor", true],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    const xlsxBytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

    await flow.driver.runToConfirmMapping({
      name: "staff.xlsx",
      bytes: xlsxBytes,
    });

    const parsed = flow.useStore.getState().parsedSheet;
    expect(parsed).toBeDefined();
    expect(parsed!.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
      "active",
    ]);
    expect(parsed!.rows).toHaveLength(2);
  });

  it("routes a JPEG drop through the vision path when AI + schema are set", async () => {
    // AIProvider whose map() returns identity AND whose extract() returns a
    // canned canonical record.
    const visionAi: AIProvider = {
      async map(input: MapInput): Promise<MapResult> {
        return {
          mappings: input.sourceColumns.map((c) => ({
            sourceColumn: c,
            canonicalField: c,
            confidence: 1,
            reason: "identity",
          })),
          unmappedRequiredFields: [],
          warnings: [],
          suggestions: [],
          needsClarification: [],
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
      async extract(_input: ExtractInput): Promise<ExtractResult> {
        return {
          extracted: {
            first_name: "Photo",
            last_name: "Worker",
            employment_type: "employee",
            active: true,
          },
          fieldConfidence: {
            first_name: 0.9,
            last_name: 0.9,
            employment_type: 0.85,
            active: 0.95,
          },
          rawText: "Photo Worker employee",
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
    };

    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: visionAi,
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    // Minimal JPEG magic bytes — enough for the format detector
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);

    await flow.driver.runToConfirmMapping({
      name: "prestart.jpg",
      bytes: jpegBytes,
    });

    const parsed = flow.useStore.getState().parsedSheet;
    expect(parsed).toBeDefined();
    expect(parsed!.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
      "active",
    ]);
    expect(parsed!.rows[0]).toMatchObject({
      first_name: "Photo",
      last_name: "Worker",
      employment_type: "employee",
      active: true,
    });
  });

  it("errors clearly when an image is dropped without AI configured", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      // no ai
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(
      flow.driver.runToConfirmMapping({ name: "prestart.jpg", bytes: jpegBytes }),
    ).rejects.toThrow(/AIProvider/i);

    const status = flow.useStore.getState().status;
    expect(status.kind).toBe("error");
    if (status.kind === "error") {
      expect(status.phase).toBe("parsing");
    }
  });
});

describe("createConfirmFlow — multi-sheet XLSX picker", () => {
  function multiSheetXlsx(): Uint8Array {
    const wb = XLSX.utils.book_new();

    // Sheet 1 — looks like jobs, not what we want
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["job_number", "client", "status"],
        ["J-001", "Acme", "open"],
        ["J-002", "Beta Pty", "closed"],
      ]),
      "Jobs",
    );

    // Sheet 2 — the staff sheet, what we actually want
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["first_name", "last_name", "employment_type", "active"],
        ["James", "Patel", "employee", true],
        ["Sarah", "O'Brien", "subcontractor", true],
        ["Michael", "Henderson", "employee", true],
      ]),
      "Staff",
    );

    // Sheet 3 — totals summary, also not what we want
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["metric", "value"],
        ["total_hours", 162],
        ["total_jobs", 8],
      ]),
      "Summary",
    );

    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  }

  it("stops at confirm_sheet when the workbook has more than one sheet", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    await flow.driver.runToConfirmMapping({
      name: "simpro-export.xlsx",
      bytes: multiSheetXlsx(),
    });

    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("confirm_sheet");
    expect(state.parsedWorkbook).toBeDefined();
    expect(state.parsedWorkbook!.sheets).toHaveLength(3);
    expect(state.parsedWorkbook!.sheets.map((s) => s.sheetName)).toEqual([
      "Jobs",
      "Staff",
      "Summary",
    ]);
    // We have not picked a sheet yet — parsedSheet stays undefined.
    expect(state.parsedSheet).toBeUndefined();
  });

  it("pickSheet(1) advances to confirm_mapping with the Staff sheet's rows", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });

    await flow.driver.runToConfirmMapping({
      name: "simpro-export.xlsx",
      bytes: multiSheetXlsx(),
    });
    expect(flow.useStore.getState().status.kind).toBe("confirm_sheet");

    // The bookkeeper picks the second sheet — Staff.
    await flow.driver.pickSheet(1);

    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("confirm_mapping");
    expect(state.parsedSheet?.sheetName).toBe("Staff");
    expect(state.parsedSheet?.rows).toHaveLength(3);
    expect(state.parsedSheet?.headerRow).toEqual([
      "first_name",
      "last_name",
      "employment_type",
      "active",
    ]);
    // The workbook is cleared once a sheet has been chosen.
    expect(state.parsedWorkbook).toBeUndefined();

    // Validation runs against the picked sheet's rows, not Jobs or Summary.
    await flow.driver.validate();
    const v = flow.useStore.getState().validationResult;
    expect(v?.summary.valid).toBe(3);
    expect(v?.valid_rows.map((r) => r.canonical["first_name"])).toEqual([
      "James",
      "Sarah",
      "Michael",
    ]);
  });

  it("pickSheet() rejects an out-of-range index", async () => {
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });
    await flow.driver.runToConfirmMapping({
      name: "simpro-export.xlsx",
      bytes: multiSheetXlsx(),
    });

    await expect(flow.driver.pickSheet(99)).rejects.toThrow(/only has 3 sheets/);
  });

  it("single-sheet XLSX skips confirm_sheet entirely", async () => {
    // Regression: a one-sheet workbook should flow straight through to
    // confirm_mapping the way it always has.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["first_name", "last_name", "employment_type", "active"],
        ["James", "Patel", "employee", true],
      ]),
      "OnlySheet",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: PERMISSIVE_STAFF_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      commit: async () => ({ committed: 0, failed: 0 }),
    });
    await flow.driver.runToConfirmMapping({
      name: "single.xlsx",
      bytes,
    });

    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("confirm_mapping");
    expect(state.parsedSheet?.sheetName).toBe("OnlySheet");
    expect(state.parsedWorkbook).toBeUndefined();
  });
});

describe("setDestination + reset", () => {
  it("stores a chip-picked destination with source='suggested'", () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setDestination("SimPRO", "suggested");
    const s = flow.useStore.getState();
    expect(s.destination).toBe("SimPRO");
    expect(s.destinationSource).toBe("suggested");
  });

  it("stores a free-text destination with source='free_text'", () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setDestination("Equinix audit pack", "free_text");
    const s = flow.useStore.getState();
    expect(s.destination).toBe("Equinix audit pack");
    expect(s.destinationSource).toBe("free_text");
  });

  it("clears destinationSource when destination is set to undefined", () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setDestination("SimPRO", "suggested");
    flow.useStore.getState().setDestination(undefined, "free_text");
    const s = flow.useStore.getState();
    expect(s.destination).toBeUndefined();
    expect(s.destinationSource).toBeUndefined();
  });

  it("reset() clears destination + source along with everything else", () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setDestination("Xero", "suggested");
    flow.useStore.getState().reset();
    const s = flow.useStore.getState();
    expect(s.destination).toBeUndefined();
    expect(s.destinationSource).toBeUndefined();
  });
});

describe("buildCommittedCsv — download for complete state", () => {
  it("returns null when no validation has run", async () => {
    const flow = createConfirmFlow();
    const { buildCommittedCsv } = await import("../src/index.js");
    expect(buildCommittedCsv(flow.useStore.getState())).toBeNull();
  });

  it("returns null when no committable rows exist", async () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setValidationResult({
      valid_rows: [],
      flagged_rows: [],
      rejected_rows: [
        {
          source_row_index: 0,
          errors: [{ field: "first_name", kind: "required", message: "missing" }],
        },
      ],
      summary: { total: 1, valid: 0, flagged: 0, rejected: 1, by_field_errors: {} },
    });
    const { buildCommittedCsv } = await import("../src/index.js");
    expect(buildCommittedCsv(flow.useStore.getState())).toBeNull();
  });

  it("emits a CSV with the union of fields across rows + RFC-4180 escaping", async () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setFile({
      name: "staff-export.csv",
      bytes: new Uint8Array(),
    });
    flow.useStore.getState().setValidationResult({
      valid_rows: [
        {
          source_row_index: 0,
          canonical: { first_name: "James", last_name: "Patel", trade: "electrical" },
        },
        {
          source_row_index: 1,
          // O'Brien needs a quoted CSV cell; also gives a value with a comma.
          canonical: {
            first_name: "Sarah",
            last_name: "O'Brien",
            notes: "ex-Akko, KNX-trained",
            active: true,
          },
        },
      ],
      flagged_rows: [],
      rejected_rows: [],
      summary: { total: 2, valid: 2, flagged: 0, rejected: 0, by_field_errors: {} },
    });

    const { buildCommittedCsv } = await import("../src/index.js");
    const built = buildCommittedCsv(flow.useStore.getState());
    expect(built).not.toBeNull();
    expect(built!.filename).toBe("staff-export-committed.csv");

    const lines = built!.content.trim().split("\n");
    expect(lines[0]).toBe("source_row_index,first_name,last_name,trade,notes,active");
    expect(lines[1]).toBe("0,James,Patel,electrical,,");
    // Sarah's row: blank `trade` because she didn't have one, quoted notes
    // because of the comma, plain `true` for active.
    expect(lines[2]).toBe(
      '1,Sarah,O\'Brien,,"ex-Akko, KNX-trained",true',
    );
  });

  it("falls back to a default filename when no file is in state", async () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setValidationResult({
      valid_rows: [{ source_row_index: 0, canonical: { x: 1 } }],
      flagged_rows: [],
      rejected_rows: [],
      summary: { total: 1, valid: 1, flagged: 0, rejected: 0, by_field_errors: {} },
    });
    const { buildCommittedCsv } = await import("../src/index.js");
    const built = buildCommittedCsv(flow.useStore.getState());
    expect(built!.filename).toBe("committed-committed.csv");
  });

  it("excludes skip_row resolutions from the download", async () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setFile({ name: "staff.csv", bytes: new Uint8Array() });
    flow.useStore.getState().setValidationResult({
      valid_rows: [{ source_row_index: 0, canonical: { first_name: "James" } }],
      flagged_rows: [
        {
          source_row_index: 1,
          canonical: { first_name: "Sarah", phone: "junk" },
          flags: [{ kind: "phone_kept_raw", field: "phone" }],
        },
      ],
      rejected_rows: [],
      summary: { total: 2, valid: 1, flagged: 1, rejected: 0, by_field_errors: {} },
    });
    // Bookkeeper marks the flagged row to skip.
    flow.useStore.getState().resolveFlag(1, { kind: "skip_row" });

    const { buildCommittedCsv } = await import("../src/index.js");
    const built = buildCommittedCsv(flow.useStore.getState())!;
    const lines = built.content.trim().split("\n");
    // Header + one row (James) — Sarah was skipped.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("0,James");
  });

  it("serialises Date values as ISO strings and objects as JSON", async () => {
    const flow = createConfirmFlow();
    flow.useStore.getState().setFile({ name: "x.csv", bytes: new Uint8Array() });
    flow.useStore.getState().setValidationResult({
      valid_rows: [
        {
          source_row_index: 0,
          canonical: {
            start_date: new Date("2022-03-01T00:00:00.000Z"),
            client_classification: { iam_id: "A-1", zone: "DC" },
          },
        },
      ],
      flagged_rows: [],
      rejected_rows: [],
      summary: { total: 1, valid: 1, flagged: 0, rejected: 0, by_field_errors: {} },
    });
    const { buildCommittedCsv } = await import("../src/index.js");
    const built = buildCommittedCsv(flow.useStore.getState())!;
    const lines = built.content.trim().split("\n");
    expect(lines[1]).toBe(
      '0,2022-03-01T00:00:00.000Z,"{""iam_id"":""A-1"",""zone"":""DC""}"',
    );
  });
});

describe("createConfirmFlow — resolutions and commit-ready", () => {
  it("respects skip_row resolutions during commit", async () => {
    const flow = createConfirmFlow();

    // Construct a validation result with a fake flagged row
    flow.useStore.getState().setValidationResult({
      valid_rows: [
        { source_row_index: 0, canonical: { first_name: "James" } },
        { source_row_index: 1, canonical: { first_name: "Sarah" } },
      ],
      flagged_rows: [
        {
          source_row_index: 2,
          canonical: { first_name: "Michael", phone: "weird" },
          flags: [{ kind: "phone_kept_raw", field: "phone" }],
        },
      ],
      rejected_rows: [],
      summary: {
        total: 3,
        valid: 2,
        flagged: 1,
        rejected: 0,
        by_field_errors: {},
      },
    });

    // Skip the flagged row
    flow.useStore.getState().resolveFlag(2, { kind: "skip_row" });

    const { computeCommitReady } = await import("../src/index.js");
    const ready = computeCommitReady(flow.useStore.getState());
    expect(ready.committable).toHaveLength(2);
    expect(ready.skipped).toEqual([2]);
  });
});
