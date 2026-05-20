/**
 * samples-validation.test.ts — validates the canonical *-clean.{csv,json}
 * sample fixtures (in repo-root samples/) against their matching schema
 * (in repo-root schemas/).
 *
 * Convention:
 *   samples/{entity}-clean.csv   → array of homogeneous rows, each must
 *                                  validate against schemas/{entity}.schema.json
 *   samples/{entity}-clean.json  → single object that must validate against
 *                                  schemas/{entity}.schema.json. May carry
 *                                  child arrays (acb_test has visual_check_items
 *                                  + electrical_readings) — those are stripped
 *                                  out of the parent and validated separately
 *                                  against the matching child schema.
 *   samples/{entity}-messy.csv   → NOT validated here. Those are real-world
 *                                  messy inputs that the import pipeline must
 *                                  COERCE before they can be validated. They
 *                                  are inputs for higher-level pipeline tests.
 *
 * If you change a *-clean fixture, expect this file to be the canary that
 * tells you whether the change still matches the schema.
 */

import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);

// Walk up from test/ to the repo root. Layout:
//   <repo-root>/
//     samples/
//     schemas/
//     eq-platform/packages/eq-validation/test/samples-validation.test.ts  <- here
// So we go up 4 levels.
const REPO_ROOT = join(dirname(__filename), "..", "..", "..", "..");
const SCHEMAS_DIR = join(REPO_ROOT, "schemas");
const SAMPLES_DIR = join(REPO_ROOT, "samples");

/** Child arrays embedded inside JSON test fixtures, by parent entity. */
const CHILD_ARRAYS: Record<string, Array<{ key: string; childEntity: string }>> = {
  acb_test: [
    { key: "visual_check_items", childEntity: "acb_visual_check_item" },
    { key: "electrical_readings", childEntity: "acb_electrical_reading" },
  ],
  nsx_test: [
    { key: "visual_check_items", childEntity: "nsx_visual_check_item" },
    { key: "electrical_readings", childEntity: "nsx_electrical_reading" },
  ],
  rcd_test: [{ key: "circuits", childEntity: "rcd_test_circuit" }],
};

async function loadSchema(entity: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(SCHEMAS_DIR, `${entity}.schema.json`), "utf8");
  return JSON.parse(raw);
}

/**
 * RFC4180-ish CSV parser. Handles quoted fields with embedded commas and
 * double-quote escapes. Good enough for our hand-crafted samples; not a
 * stand-in for a real library.
 */
function parseCsv(raw: string): Array<Record<string, string | null>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // skip - newline handler covers it on the next char
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const out: Record<string, string | null> = {};
    header.forEach((col, i) => {
      const v = (cells[i] ?? "").trim();
      out[col] = v === "" ? null : v;
    });
    return out;
  });
}

/**
 * Type-direct CSV coercion: use the schema's declared property type to
 * decide how to coerce each cell. CSV is string-typed by definition; the
 * schema tells us what each column should actually be.
 *
 *   schema type   | coercion
 *   --------------|------------------------------------------------------
 *   string        | leave as string
 *   boolean       | "true"/"1" → true, "false"/"0" → false
 *   integer       | parseInt; null on NaN
 *   number        | parseFloat; null on NaN
 *   object        | JSON.parse (for JSONB fields like year_totals)
 *   array         | JSON.parse
 *
 * If the schema lists a union (e.g. ["integer", "null"]) we use the first
 * non-"null" entry. Real importer coercion is richer (see coerce-*.ts);
 * this is a test-side shortcut.
 */
function pickType(propType: unknown): string | null {
  if (typeof propType === "string") return propType;
  if (Array.isArray(propType)) {
    const nonNull = propType.find((t) => t !== "null");
    return typeof nonNull === "string" ? nonNull : null;
  }
  return null;
}

function coerceWithSchema(
  row: Record<string, string | null>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, { type?: unknown }>;
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(row)) {
    if (raw === null) {
      out[k] = null;
      continue;
    }
    const t = pickType(props[k]?.type);
    if (t === "boolean") {
      out[k] = raw === "true" || raw === "1";
    } else if (t === "integer") {
      const n = parseInt(raw, 10);
      out[k] = Number.isFinite(n) ? n : null;
    } else if (t === "number") {
      const n = Number(raw);
      out[k] = Number.isFinite(n) ? n : null;
    } else if (t === "object" || t === "array") {
      try {
        out[k] = JSON.parse(raw);
      } catch {
        out[k] = raw;
      }
    } else {
      // string or unknown — leave as text
      out[k] = raw;
    }
  }
  return out;
}

function makeAjv() {
  const ajv = new Ajv2020({
    strict: false, // x-eq-* extension keys
    allErrors: true,
    coerceTypes: false,
  });
  addFormats(ajv);
  return ajv;
}

describe("canonical sample fixtures match their schemas", async () => {
  const ajv = makeAjv();
  const files = await readdir(SAMPLES_DIR);
  const cleanFiles = files.filter((f) => f.includes("-clean.") || f.includes("-jemena-board."));

  // Pre-discover so we get meaningful failures if the harness can't see
  // the samples at all.
  it("discovers at least one clean sample", () => {
    expect(cleanFiles.length).toBeGreaterThan(0);
  });

  for (const file of cleanFiles) {
    // Derive entity name from the filename. Strip a trailing -clean or
    // -jemena-board flavour tag, then the extension.
    const entity = file
      .replace(/\.(csv|json)$/, "")
      .replace(/-jemena-board$/, "")
      .replace(/-clean$/, "");

    const ext = file.endsWith(".json") ? "json" : "csv";

    it(`${file} → schemas/${entity}.schema.json`, async () => {
      const schema = await loadSchema(entity);
      const validate = ajv.compile(schema);

      const raw = await readFile(join(SAMPLES_DIR, file), "utf8");

      if (ext === "csv") {
        const rows = parseCsv(raw);
        expect(rows.length).toBeGreaterThan(0);
        const required: string[] = Array.isArray((schema as { required?: unknown[] }).required)
          ? ((schema as { required: string[] }).required ?? [])
          : [];
        const props = ((schema as { properties?: Record<string, { format?: string }> }).properties
          ?? {}) as Record<string, { format?: string }>;
        for (let i = 0; i < rows.length; i++) {
          const coerced = coerceWithSchema(rows[i]!, schema);
          // Drop null values — for optional fields they're a no-op, and for
          // required fields the schema validator can give us the clearer
          // missing-property error.
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(coerced)) {
            if (v !== null) cleaned[k] = v;
          }
          // Inject system-managed tenant_id if required+missing.
          if (required.includes("tenant_id") && cleaned.tenant_id === undefined) {
            cleaned.tenant_id = "ccca00fc-cbc8-442e-9489-0f1f216ddca8";
          }
          // Inject the entity's primary-key UUID column. Convention:
          // `${entity}_id` (customer_id, plan_id, check_id, attachment_id,
          // entry_id for pm_calendar, etc.). We pull the actual column name
          // from `required` so we don't hard-code per-entity logic.
          const pkCol = required.find((k) => {
            if (!k.endsWith("_id") || k === "tenant_id") return false;
            const p = props[k] as { format?: string } | undefined;
            return p?.format === "uuid";
          });
          if (pkCol && cleaned[pkCol] === undefined) {
            cleaned[pkCol] = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
          }
          const ok = validate(cleaned);
          if (!ok) {
            console.error(`${file} row ${i} failed:`, validate.errors);
          }
          expect(ok, `row ${i} should validate against ${entity}.schema.json`).toBe(true);
        }
        return;
      }

      // JSON fixture path.
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Separate child arrays for separate validation.
      const childArrays = CHILD_ARRAYS[entity] ?? [];
      const childData: Array<{ entity: string; rows: unknown[] }> = [];
      const parentOnly = { ...parsed };
      for (const ch of childArrays) {
        const rows = parsed[ch.key];
        if (Array.isArray(rows)) {
          childData.push({ entity: ch.childEntity, rows });
        }
        delete parentOnly[ch.key];
      }

      const ok = validate(parentOnly);
      if (!ok) console.error(`${file} parent failed:`, validate.errors);
      expect(ok, `${file} parent shape should match ${entity}.schema.json`).toBe(true);

      for (const ch of childData) {
        const childSchema = await loadSchema(ch.entity);
        const validateChild = ajv.compile(childSchema);
        for (let i = 0; i < ch.rows.length; i++) {
          const row = ch.rows[i] as Record<string, unknown>;
          const okChild = validateChild(row);
          if (!okChild) {
            console.error(`${file} child[${ch.entity}][${i}] failed:`, validateChild.errors);
          }
          expect(okChild, `${file} child ${ch.entity}[${i}] should match`).toBe(true);
        }
      }
    });
  }
});
