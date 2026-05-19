/**
 * coerceNumber — strict-shape tests added 2026-05-19 after the overnight review
 * caught silent corruption on inputs like "1 234.56" (parseFloat truncates at
 * the space, returning 1) and "0x1F" (parseFloat returns 0).
 *
 * The pre-fix behaviour was to call parseFloat directly on a normalised string
 * and accept whatever came back. parseFloat is greedy — it consumes a prefix
 * and silently discards the rest. The fix validates the normalised string
 * matches a clean decimal-number shape BEFORE calling parseFloat.
 */

import { describe, it, expect } from "vitest";
import { coerceNumber } from "../src/coerce-number.js";

describe("coerceNumber — happy path", () => {
  it("plain integer", () => {
    expect(coerceNumber("123")).toMatchObject({ ok: true, value: 123 });
  });
  it("plain decimal", () => {
    expect(coerceNumber("123.45")).toMatchObject({ ok: true, value: 123.45 });
  });
  it("negative", () => {
    expect(coerceNumber("-789")).toMatchObject({ ok: true, value: -789 });
  });
  it("AU thousands + decimal", () => {
    expect(coerceNumber("1,234.56")).toMatchObject({ ok: true, value: 1234.56 });
  });
  it("currency prefix", () => {
    expect(coerceNumber("$1,234.56")).toMatchObject({ ok: true, value: 1234.56 });
  });
  it("European decimal", () => {
    // "1.234,56" means 1234.56 in EU notation (comma is decimal, period is thousands).
    // The coercer correctly normalises this.
    expect(coerceNumber("1.234,56")).toMatchObject({ ok: true, value: 1234.56 });
  });
  it("accounting negative", () => {
    expect(coerceNumber("(789)")).toMatchObject({ ok: true, value: -789 });
  });
  it("scientific notation", () => {
    expect(coerceNumber("1.23e10")).toMatchObject({ ok: true, value: 1.23e10 });
  });
  it("scientific notation with explicit +", () => {
    expect(coerceNumber("1.23E+10")).toMatchObject({ ok: true, value: 1.23e10 });
  });
});

describe("coerceNumber — strict-shape rejection (regression: was silently parsing partial input)", () => {
  it("space inside number is rejected (was returning 1)", () => {
    // "1 234.56" used to return 1 — parseFloat stops at the space and silently
    // discards everything after. Now correctly rejected.
    const r = coerceNumber("1 234.56");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("hex literal is rejected (was returning 0)", () => {
    // "0x1F" used to return 0 — parseFloat reads "0" and stops at "x".
    const r = coerceNumber("0x1F");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("multiple decimals is rejected", () => {
    const r = coerceNumber("1.23.45");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("trailing junk is rejected", () => {
    const r = coerceNumber("123abc");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("leading junk is rejected (currency is handled separately by strip)", () => {
    const r = coerceNumber("abc123");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("just a dot is rejected", () => {
    const r = coerceNumber(".");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("'Infinity' literal is rejected", () => {
    const r = coerceNumber("Infinity");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });

  it("'NaN' literal is rejected", () => {
    const r = coerceNumber("NaN");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("number_unparseable");
  });
});

describe("coerceNumber — edge cases that still parse cleanly", () => {
  it("leading decimal: .45 → 0.45", () => {
    expect(coerceNumber(".45")).toMatchObject({ ok: true, value: 0.45 });
  });
  it("trailing decimal: 123. → 123", () => {
    expect(coerceNumber("123.")).toMatchObject({ ok: true, value: 123 });
  });
  it("empty string → null (lenient)", () => {
    expect(coerceNumber("")).toMatchObject({ ok: true, value: null });
  });
  it("null → null (lenient)", () => {
    expect(coerceNumber(null)).toMatchObject({ ok: true, value: null });
  });
  it("percentage 50% → 0.5", () => {
    expect(coerceNumber("50%")).toMatchObject({ ok: true, value: 0.5 });
  });
});
