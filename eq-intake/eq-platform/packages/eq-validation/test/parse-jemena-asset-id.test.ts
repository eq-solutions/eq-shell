import { describe, it, expect } from "vitest";
import {
  isJemenaAssetId,
  extractJemenaAssetId,
  extractAllJemenaAssetIds,
} from "../src/parse-jemena-asset-id";

describe("isJemenaAssetId", () => {
  it("accepts canonical 6-digit Jemena ids", () => {
    expect(isJemenaAssetId("JM003534")).toBe(true);
    expect(isJemenaAssetId("JM003468")).toBe(true);
    expect(isJemenaAssetId("JM999999")).toBe(true);
  });

  it("accepts 4–8 digit variants (older fleets / future growth)", () => {
    expect(isJemenaAssetId("JM1234")).toBe(true);
    expect(isJemenaAssetId("JM12345678")).toBe(true);
  });

  it("accepts lowercase prefix (case-insensitive)", () => {
    expect(isJemenaAssetId("jm003534")).toBe(true);
    expect(isJemenaAssetId("Jm003534")).toBe(true);
    expect(isJemenaAssetId("jM003534")).toBe(true);
  });

  it("trims input", () => {
    expect(isJemenaAssetId(" JM003534 ")).toBe(true);
    expect(isJemenaAssetId("\tJM003534\n")).toBe(true);
  });

  it("rejects per-circuit bare digits (sub-asset ids)", () => {
    expect(isJemenaAssetId("30248")).toBe(false);
    expect(isJemenaAssetId("12345")).toBe(false);
  });

  it("rejects ids with surrounding text — use extractJemenaAssetId for that", () => {
    expect(isJemenaAssetId("Cardiff DB-1 (JM003534)")).toBe(false);
    expect(isJemenaAssetId("JM003534 board")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isJemenaAssetId("JM")).toBe(false);
    expect(isJemenaAssetId("JM123")).toBe(false); // 3 digits, too short
    expect(isJemenaAssetId("JM123456789")).toBe(false); // 9 digits, too long
    expect(isJemenaAssetId("JMA003534")).toBe(false); // letter in number
    expect(isJemenaAssetId("J003534")).toBe(false); // missing M
    expect(isJemenaAssetId("")).toBe(false);
    expect(isJemenaAssetId(null)).toBe(false);
    expect(isJemenaAssetId(undefined)).toBe(false);
  });
});

describe("extractJemenaAssetId", () => {
  it("extracts the id from canonical inputs", () => {
    expect(extractJemenaAssetId("JM003534")).toBe("JM003534");
  });

  it("extracts from free text with the id embedded", () => {
    expect(extractJemenaAssetId("Cardiff DB-1 (JM003534)")).toBe("JM003534");
    expect(extractJemenaAssetId("Board JM003534 — Unit 2")).toBe("JM003534");
    expect(extractJemenaAssetId("Asset id is jm003534 per the register")).toBe("JM003534");
  });

  it("normalises lower-case prefix to upper-case", () => {
    expect(extractJemenaAssetId("jm003534")).toBe("JM003534");
    expect(extractJemenaAssetId("see jm003534 today")).toBe("JM003534");
  });

  it("returns the FIRST match when several are present", () => {
    expect(extractJemenaAssetId("Replaced JM003534 with JM003468")).toBe("JM003534");
  });

  it("returns null when no id is present", () => {
    expect(extractJemenaAssetId("just a description")).toBe(null);
    expect(extractJemenaAssetId("Maximo asset 30248")).toBe(null);
    expect(extractJemenaAssetId("")).toBe(null);
    expect(extractJemenaAssetId(null)).toBe(null);
    expect(extractJemenaAssetId(undefined)).toBe(null);
  });

  it("doesn't match JM when not at a word boundary", () => {
    // A JM-prefixed code that's part of a larger identifier shouldn't match.
    expect(extractJemenaAssetId("XJM003534")).toBe(null);
    expect(extractJemenaAssetId("AJM003534Y")).toBe(null);
  });
});

describe("extractAllJemenaAssetIds", () => {
  it("returns all ids in source order, de-duped, upper-cased", () => {
    expect(
      extractAllJemenaAssetIds("Replaced JM003534 with jm003468. JM003534 archived."),
    ).toEqual(["JM003534", "JM003468"]);
  });

  it("returns empty array when no ids are present", () => {
    expect(extractAllJemenaAssetIds("just text")).toEqual([]);
    expect(extractAllJemenaAssetIds("")).toEqual([]);
    expect(extractAllJemenaAssetIds(null)).toEqual([]);
  });
});
