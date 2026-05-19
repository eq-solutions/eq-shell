/**
 * Tests for groupRejectedRows — collapses identical-error rejected rows
 * so the UI doesn't have to render 1000+ identical lines.
 */

import { describe, it, expect } from "vitest";
import { groupRejectedRows } from "../src/components/FlaggedRowsTable.js";
import type { ValidationError } from "@eq/validation";

function row(idx: number, ...errors: ValidationError[]) {
  return { source_row_index: idx, errors };
}

describe("groupRejectedRows", () => {
  it("returns empty list when no rows are rejected", () => {
    expect(groupRejectedRows([])).toEqual([]);
  });

  it("collapses rows with identical errors into one group", () => {
    const rejected = [
      row(0, { kind: "field_required", field: "first_name" }),
      row(1, { kind: "field_required", field: "first_name" }),
      row(2, { kind: "field_required", field: "first_name" }),
    ];
    const groups = groupRejectedRows(rejected);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].errorLabels).toEqual(["Missing required field: first_name"]);
  });

  it("keeps groups separate when error sets differ", () => {
    const rejected = [
      row(0, { kind: "field_required", field: "first_name" }),
      row(1, { kind: "field_required", field: "last_name" }),
      row(2, { kind: "field_required", field: "first_name" }),
    ];
    const groups = groupRejectedRows(rejected);
    expect(groups).toHaveLength(2);
    // Most-common first
    expect(groups[0].rows.map((r) => r.source_row_index)).toEqual([0, 2]);
    expect(groups[1].rows.map((r) => r.source_row_index)).toEqual([1]);
  });

  it("groups multi-error rows identically when the error set matches (order-insensitive)", () => {
    const rejected = [
      row(
        0,
        { kind: "field_required", field: "first_name" },
        { kind: "field_required", field: "last_name" },
      ),
      row(
        1,
        // Different order in the row, same fingerprint
        { kind: "field_required", field: "last_name" },
        { kind: "field_required", field: "first_name" },
      ),
    ];
    const groups = groupRejectedRows(rejected);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("orders groups by row count, descending", () => {
    const rejected = [
      row(0, { kind: "field_required", field: "first_name" }),
      row(1, { kind: "field_required", field: "last_name" }),
      row(2, { kind: "field_required", field: "last_name" }),
      row(3, { kind: "field_required", field: "last_name" }),
    ];
    const groups = groupRejectedRows(rejected);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].errorLabels).toEqual(["Missing required field: last_name"]);
    expect(groups[1].rows).toHaveLength(1);
  });

  it("collapses 1000 identical rejections to one group with 1000 rows", () => {
    // Mirrors the real #Job List.xlsx failure mode: every row missing
    // the same three required staff fields.
    const rejected = Array.from({ length: 1000 }, (_, i) =>
      row(
        i,
        { kind: "field_required", field: "first_name" },
        { kind: "field_required", field: "last_name" },
        { kind: "field_required", field: "employment_type" },
      ),
    );
    const groups = groupRejectedRows(rejected);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1000);
    expect(groups[0].errorLabels).toHaveLength(3);
  });
});
