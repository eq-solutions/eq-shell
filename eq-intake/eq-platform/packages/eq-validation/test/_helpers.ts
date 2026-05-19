/**
 * Test helpers — minimal CSV parser for fixture-driven coercer tests.
 * Inputs in the fixtures don't contain commas, so a simple split is safe.
 * Don't reach for a real CSV lib here — fixture format is deliberately small.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const FIXTURES_DIR = join(dirname(__filename), "fixtures");

export async function loadFixture(name: string): Promise<Array<Record<string, string>>> {
  const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0]!.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      // Re-join trailing cells if there are more commas than headers (rare;
      // the "note" column may contain commas in some fixtures).
      if (i === header.length - 1) {
        row[col] = cells.slice(i).join(",").trim();
      } else {
        row[col] = (cells[i] ?? "").trim();
      }
    });
    return row;
  });
}

/**
 * Parse the "expected" column of a fixture into a structured assertion target.
 *   "ERROR:code"  → { kind: "error", code: "code" }
 *   "null"        → { kind: "null" }
 *   "abc"         → { kind: "value", value: "abc" }
 *   ""            → { kind: "empty" }
 */
export type ExpectedAssertion =
  | { kind: "value"; value: string }
  | { kind: "error"; code: string }
  | { kind: "null" }
  | { kind: "empty" };

export function parseExpected(s: string): ExpectedAssertion {
  if (s === "") return { kind: "empty" };
  if (s === "null") return { kind: "null" };
  if (s.startsWith("ERROR:")) return { kind: "error", code: s.slice("ERROR:".length) };
  return { kind: "value", value: s };
}
