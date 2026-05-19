/**
 * Smoke test for the codegen pipeline.
 *
 * Confirms:
 *   1. The generated Zod validator for `staff` exists and is importable.
 *   2. A known-good fixture row passes validation.
 *   3. A known-bad fixture row (missing required fields) fails validation.
 *
 * If this test fails, run `pnpm generate` first — generated files live in
 * src/generated/ and are gitignored.
 */

import { describe, it, expect } from "vitest";
import { staffSchema } from "../src/generated/staff.zod.js";

const VALID_STAFF = {
  staff_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  first_name: "Sample",
  last_name: "Sparkie",
  employment_type: "apprentice",
  active: true,
};

const INVALID_STAFF_MISSING_REQUIRED = {
  // missing staff_id, tenant_id, first_name, last_name, employment_type, active
  preferred_name: "Spark",
};

const INVALID_STAFF_BAD_ENUM = {
  ...VALID_STAFF,
  employment_type: "wizard", // not in the enum
};

describe("staffSchema (generated Zod validator)", () => {
  it("accepts a minimal valid record", () => {
    const result = staffSchema.safeParse(VALID_STAFF);
    expect(result.success).toBe(true);
  });

  it("rejects a record missing required fields", () => {
    const result = staffSchema.safeParse(INVALID_STAFF_MISSING_REQUIRED);
    expect(result.success).toBe(false);
  });

  it("rejects a record with an invalid employment_type enum value", () => {
    const result = staffSchema.safeParse(INVALID_STAFF_BAD_ENUM);
    expect(result.success).toBe(false);
  });
});
