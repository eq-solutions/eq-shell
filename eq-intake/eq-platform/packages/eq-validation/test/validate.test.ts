/**
 * Orchestrator end-to-end tests - exercises validate() against the staff
 * schema using the staff-clean.csv (happy path) and staff-messy.csv (real-
 * world mess) fixtures.
 *
 * Brief Sprint 4 deliverable list, mostly. The import_mode handling lives
 * at the SQL RPC layer (eq_intake_commit_batch), so it isn't tested here -
 * Supabase migrations land in a later sprint.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/validate.js";
import type { FkLookup } from "../src/fk-resolver.js";
import { loadFixture } from "./_helpers.js";

const __filename = fileURLToPath(import.meta.url);
const SCHEMAS_DIR = join(dirname(__filename), "..", "..", "eq-schemas", "src", "schemas");

async function loadSchema(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(SCHEMAS_DIR, name + ".schema.json"), "utf8");
  return JSON.parse(raw);
}

const TENANT = "00000000-0000-4000-8000-000000000001";

describe("validate() - staff schema, clean fixture", async () => {
  const staffSchema = await loadSchema("staff");
  const cleanRows = await loadFixture("staff-clean.csv");

  const cleanMapping: Record<string, string | null> = {
    first_name: "first_name",
    last_name: "last_name",
    email: "email",
    phone: "phone",
    employment_type: "employment_type",
    trade: "trade",
    start_date: "start_date",
    active: "active",
  };

  it("commits every clean row cleanly (valid or warning-flagged, never rejected)", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: cleanMapping,
      rows: cleanRows,
      tenantId: TENANT,
    });

    expect(result.summary.total).toBe(cleanRows.length);
    expect(result.summary.rejected).toBe(0);
    expect(result.summary.valid + result.summary.flagged).toBe(cleanRows.length);
  });

  it("populates canonical with coerced values", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: cleanMapping,
      rows: cleanRows,
      tenantId: TENANT,
    });

    const first = result.valid_rows[0]!;
    expect(first.canonical["first_name"]).toBe("James");
    expect(first.canonical["last_name"]).toBe("Patel");
    expect(first.canonical["employment_type"]).toBe("employee");
    expect(first.canonical["active"]).toBe(true);
    expect(first.canonical["start_date"]).toBe("2022-03-01");
  });
});

describe("validate() - staff schema, messy fixture", async () => {
  const staffSchema = await loadSchema("staff");
  const messyRows = await loadFixture("staff-messy.csv");

  const messyMapping: Record<string, string | null> = {
    "Emp #": "external_id",
    "Mob": "phone",
    "Type": "employment_type",
    "Started": "start_date",
    "Rate": "hourly_rate_cost",
    "Trade": "trade",
    "Name": null,
    "first_name": "first_name",
    "last_name": "last_name",
  };

  const transformations = {
    Name: { kind: "split-name" as const, targets: ["first_name", "last_name"] as [string, string] },
  };

  it("succeeds on most rows; flags or rejects the rest", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: messyMapping,
      transformations,
      rows: messyRows,
      tenantId: TENANT,
    });

    expect(result.summary.total).toBe(messyRows.length);
    expect(result.summary.valid + result.summary.flagged + result.summary.rejected).toBe(messyRows.length);
    expect(result.summary.valid + result.summary.flagged).toBeGreaterThanOrEqual(messyRows.length - 2);
  });

  it("preserves unparseable phone with phone_kept_raw flag", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: messyMapping,
      transformations,
      rows: messyRows,
      tenantId: TENANT,
    });

    const tomFlagged = result.flagged_rows.find((r) =>
      String(r.canonical["last_name"] ?? "").includes("Sullivan"),
    );
    expect(tomFlagged).toBeDefined();
    expect(tomFlagged?.flags.some((f) => f.kind === "phone_kept_raw")).toBe(true);
  });

  it("resolves enum aliases for employment_type (FT->employee, Sub->subcontractor)", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: messyMapping,
      transformations,
      rows: messyRows,
      tenantId: TENANT,
    });

    const all = [...result.valid_rows, ...result.flagged_rows];
    const ftRow = all.find((r) => r.canonical["external_id"] === "E0023");
    expect(ftRow?.canonical["employment_type"]).toBe("employee");

    const subRow = all.find((r) => r.canonical["external_id"] === "E0024");
    expect(subRow?.canonical["employment_type"]).toBe("subcontractor");
  });

  it("parses AU dates (1/3/2022) and Excel serials (42867)", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: messyMapping,
      transformations,
      rows: messyRows,
      tenantId: TENANT,
    });

    const all = [...result.valid_rows, ...result.flagged_rows];
    const auDate = all.find((r) => r.canonical["external_id"] === "E0023");
    expect(auDate?.canonical["start_date"]).toBe("2022-03-01");

    const excelRow = all.find((r) => r.canonical["external_id"] === "E0034");
    expect(typeof excelRow?.canonical["start_date"]).toBe("string");
    expect(String(excelRow?.canonical["start_date"]).length).toBe(10);
  });
});

describe("validate() - required fields", async () => {
  const staffSchema = await loadSchema("staff");

  it("rejects a row missing a required field (last_name)", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: { first_name: "first_name", employment_type: "employment_type" },
      rows: [{ first_name: "Solo", employment_type: "employee" }],
      tenantId: TENANT,
    });

    expect(result.summary.rejected).toBe(1);
    const errs = result.rejected_rows[0]!.errors;
    expect(errs.some((e) => e.kind === "field_required" && e.field === "last_name")).toBe(true);
  });

  it("does not require system-managed fields (staff_id, tenant_id) at import time", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: {
        first_name: "first_name",
        last_name: "last_name",
        employment_type: "employment_type",
      },
      rows: [{ first_name: "A", last_name: "B", employment_type: "employee" }],
      tenantId: TENANT,
    });

    expect(result.summary.valid + result.summary.flagged).toBe(1);
    expect(result.summary.rejected).toBe(0);
  });
});

describe("validate() - cross-field rules", async () => {
  const staffSchema = await loadSchema("staff");

  it("flags or rejects when end_date is before start_date", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: {
        first_name: "first_name",
        last_name: "last_name",
        employment_type: "employment_type",
        start_date: "start_date",
        end_date: "end_date",
        active: "active",
      },
      rows: [
        {
          first_name: "Ex",
          last_name: "Worker",
          employment_type: "employee",
          start_date: "2024-06-30",
          end_date: "2022-03-01",
          active: false,
        },
      ],
      tenantId: TENANT,
    });

    expect(result.summary.valid).toBe(0);
    const all = [...result.flagged_rows, ...result.rejected_rows];
    expect(all.length).toBe(1);
  });
});

describe("validate() - FK resolution", async () => {
  const staffSchema = await loadSchema("staff");

  it("flags fuzzy FK matches with candidates", async () => {
    const fkLookup: FkLookup = {
      async list(entity, _tenantId) {
        if (entity === "site") {
          return [
            { id: "00000000-0000-4000-8000-000000000099", fields: { name: "Equinix SY3", code: "SY3" } },
            { id: "00000000-0000-4000-8000-000000000100", fields: { name: "Equinix SY4", code: "SY4" } },
          ];
        }
        return [];
      },
      async byId() { return null; },
    };

    const result = await validate({
      schema: staffSchema,
      mapping: {
        first_name: "first_name",
        last_name: "last_name",
        employment_type: "employment_type",
        default_site_id: "default_site_id",
      },
      rows: [
        {
          first_name: "Sparkie",
          last_name: "One",
          employment_type: "employee",
          default_site_id: "Equinix SY-3",
        },
      ],
      tenantId: TENANT,
      fkLookup,
    });

    expect(result.summary.flagged).toBe(1);
    const flag = result.flagged_rows[0]!.flags.find((f) => f.kind === "fk_fuzzy_match");
    expect(flag).toBeDefined();
  });

  it("rejects rows with FK no_match", async () => {
    const fkLookup: FkLookup = {
      async list() { return []; },
      async byId() { return null; },
    };

    const result = await validate({
      schema: staffSchema,
      mapping: {
        first_name: "first_name",
        last_name: "last_name",
        employment_type: "employment_type",
        default_site_id: "default_site_id",
      },
      rows: [
        {
          first_name: "Sparkie",
          last_name: "Two",
          employment_type: "employee",
          default_site_id: "Mystery Site",
        },
      ],
      tenantId: TENANT,
      fkLookup,
    });

    expect(result.summary.rejected).toBe(1);
    const errs = result.rejected_rows[0]!.errors;
    expect(errs.some((e) => e.kind === "fk_no_match")).toBe(true);
  });
});

describe("validate() - schema currency guard", async () => {
  const staffSchema = await loadSchema("staff");

  it("throws when isCurrentSchema is false and allowNonCurrentSchema is not set", async () => {
    await expect(
      validate({
        schema: staffSchema,
        mapping: { first_name: "first_name", last_name: "last_name", employment_type: "employment_type" },
        rows: [{ first_name: "A", last_name: "B", employment_type: "employee" }],
        tenantId: TENANT,
        isCurrentSchema: false,
      }),
    ).rejects.toThrow(/non-current schema/);
  });

  it("proceeds when allowNonCurrentSchema: true is set explicitly", async () => {
    const result = await validate({
      schema: staffSchema,
      mapping: { first_name: "first_name", last_name: "last_name", employment_type: "employment_type" },
      rows: [{ first_name: "A", last_name: "B", employment_type: "employee" }],
      tenantId: TENANT,
      isCurrentSchema: false,
      allowNonCurrentSchema: true,
    });
    expect(result.summary.total).toBe(1);
  });
});

describe("validate() - maxRowsToReturn cap", async () => {
  const staffSchema = await loadSchema("staff");

  it("caps result at maxRowsToReturn rows", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      first_name: "F" + i,
      last_name: "L" + i,
      employment_type: "employee",
    }));

    const result = await validate({
      schema: staffSchema,
      mapping: { first_name: "first_name", last_name: "last_name", employment_type: "employment_type" },
      rows,
      tenantId: TENANT,
      maxRowsToReturn: 5,
    });

    expect(result.summary.total).toBe(20);
    const processed = result.summary.valid + result.summary.flagged + result.summary.rejected;
    expect(processed).toBe(5);
  });

  /**
   * Regression: a real SimPRO customer export had 156 rows fail "Invalid
   * format on email: email" because empty CSV cells came through as ""
   * (not null), and the format check treated "" as a non-email string.
   * Empty strings should be null-equivalent for format + pattern checks
   * on nullable fields — they're "no value", not "wrong value".
   */
  it("does not flag empty-string emails as invalid format", async () => {
    const schema = {
      $id: "https://schemas.eq.solutions/test/email-shape.json",
      "x-eq-entity": "thing",
      type: "object",
      required: ["first_name"],
      properties: {
        first_name: { type: "string" },
        email: { type: ["string", "null"], format: "email" },
      },
    };
    const result = await validate({
      schema,
      mapping: { first_name: "first_name", email: "email" },
      rows: [
        { first_name: "James", email: "" }, // empty string — must NOT reject
        { first_name: "Sarah", email: "sarah@example.com.au" }, // valid email
        { first_name: "Mike", email: "not-an-email" }, // genuinely invalid
        { first_name: "Lien", email: null }, // explicit null — must NOT reject
      ],
      tenantId: TENANT,
    });
    expect(result.summary.valid).toBe(3); // James, Sarah, Lien
    expect(result.summary.rejected).toBe(1); // Mike only
    expect(result.rejected_rows[0]?.source_row_index).toBe(2);
  });
});
