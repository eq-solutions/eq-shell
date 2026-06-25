/**
 * Duplicate detection — within-batch and against-existing.
 */

import { describe, it, expect, vi } from "vitest";
import {
  detectDuplicates,
  findExistingDuplicates,
  type DedupRow,
  type ExistingAssetMatch,
} from "../src/dedup.js";

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

describe("detectDuplicates — within batch", () => {
  it("flags a later row sharing a serial_number, pointing at the first", () => {
    const rows: DedupRow[] = [
      { index: 0, canonical: { name: "A", serial_number: "SN-100" } },
      { index: 1, canonical: { name: "B", serial_number: "SN-200" } },
      { index: 2, canonical: { name: "C", serial_number: "sn-100" } }, // case-insensitive dup of row 0
    ];
    const findings = detectDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      index: 2,
      reason: "serial",
      matchType: "within_batch",
      duplicateOf: 0,
    });
  });

  it("flags same external_id only within the same site", () => {
    const rows: DedupRow[] = [
      { index: 0, canonical: { external_id: "TAG-1", site_id: SITE_A } },
      { index: 1, canonical: { external_id: "TAG-1", site_id: SITE_B } }, // different site -> not a dup
      { index: 2, canonical: { external_id: "TAG-1", site_id: SITE_A } }, // same site -> dup of row 0
    ];
    const findings = detectDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      index: 2,
      reason: "external_id_site",
      duplicateOf: 0,
    });
  });

  it("ignores rows with no serial and no site-scoped external_id", () => {
    const rows: DedupRow[] = [
      { index: 0, canonical: { name: "A", external_id: "TAG-9" } }, // external_id but no site
      { index: 1, canonical: { name: "B" } },
    ];
    expect(detectDuplicates(rows)).toEqual([]);
  });
});

describe("findExistingDuplicates — against the DB", () => {
  it("matches existing assets by serial and carries the existing asset_id", async () => {
    const rows: DedupRow[] = [
      { index: 0, canonical: { name: "A", serial_number: "SN-100" } },
      { index: 1, canonical: { name: "B", serial_number: "SN-999" } },
    ];
    const lookup = vi.fn(async (): Promise<ExistingAssetMatch[]> => [
      { asset_id: "existing-asset-1", serial_number: "SN-100" },
    ]);

    const findings = await findExistingDuplicates(rows, lookup);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      index: 0,
      matchType: "existing",
      reason: "serial",
      existingAssetId: "existing-asset-1",
    });
  });

  it("re-importing the same export flags 100% of rows as existing dupes", async () => {
    const rows: DedupRow[] = [
      { index: 0, canonical: { serial_number: "SN-1", site_id: SITE_A, external_id: "T1" } },
      { index: 1, canonical: { serial_number: "SN-2", site_id: SITE_A, external_id: "T2" } },
    ];
    // The DB already has both, keyed by serial.
    const lookup = async (): Promise<ExistingAssetMatch[]> => [
      { asset_id: "a1", serial_number: "SN-1" },
      { asset_id: "a2", serial_number: "SN-2" },
    ];
    const findings = await findExistingDuplicates(rows, lookup);
    expect(findings.map((f) => f.index)).toEqual([0, 1]);
    expect(findings.every((f) => f.matchType === "existing")).toBe(true);
  });
});
