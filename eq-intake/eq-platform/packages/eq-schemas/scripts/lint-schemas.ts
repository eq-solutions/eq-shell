/**
 * scripts/lint-schemas.ts — meta-validate every *.schema.json against
 * JSON Schema draft 2020-12.
 *
 * Per Sprint 1 decision #11: catches malformed schemas at PR time, not at
 * runtime. Run via `pnpm schemas:lint`.
 *
 * Behaviour:
 *   - Loads every *.schema.json from src/schemas/
 *   - Validates each against the draft 2020-12 meta-schema (via Ajv 2020)
 *   - Validates each schema's own $schema field declares draft 2020-12
 *   - Validates each schema has a stable $id under https://schemas.eq.solutions/
 *     (Sprint 1 decision #12 — these are identifiers; not required to resolve)
 *   - Exits non-zero if any schema fails
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const PKG_ROOT = resolve(process.cwd());
const SCHEMAS_DIR = join(PKG_ROOT, "src", "schemas");

const REQUIRED_DOLLAR_SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const REQUIRED_ID_PREFIX = "https://schemas.eq.solutions/";

interface FileFailure {
  file: string;
  reasons: string[];
}

async function main() {
  const all = await readdir(SCHEMAS_DIR);
  const files = all.filter((f) => f.endsWith(".schema.json")).sort();

  if (files.length === 0) {
    console.error(`[schemas:lint] No *.schema.json files found in ${SCHEMAS_DIR}`);
    process.exit(1);
  }

  const ajv = new Ajv2020({
    strict: false, // x-eq-* extension keys are non-standard; allow them
    allErrors: true,
  });
  addFormats(ajv);

  const failures: FileFailure[] = [];

  for (const file of files) {
    const path = join(SCHEMAS_DIR, file);
    const raw = await readFile(path, "utf8");
    const reasons: string[] = [];

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ file, reasons: [`JSON parse error: ${msg}`] });
      continue;
    }

    // Sprint 1 decision #11 — meta-validate against draft 2020-12.
    // Ajv 2020 ships the meta-schema and uses it by default; we just need
    // to compile the schema and Ajv will throw on structural problems.
    try {
      ajv.compile(json as object);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reasons.push(`Failed draft-2020-12 meta-validation: ${msg}`);
    }

    const obj = json as Record<string, unknown>;

    // Stricter EQ-specific rules (Sprint 1 decisions #11 + #12).
    if (obj["$schema"] !== REQUIRED_DOLLAR_SCHEMA) {
      reasons.push(
        `\$schema must be "${REQUIRED_DOLLAR_SCHEMA}" (got ${JSON.stringify(obj["$schema"])})`,
      );
    }

    const id = obj["$id"];
    if (typeof id !== "string" || !id.startsWith(REQUIRED_ID_PREFIX)) {
      reasons.push(
        `\$id must be a string starting with "${REQUIRED_ID_PREFIX}" (got ${JSON.stringify(id)})`,
      );
    }

    if (typeof obj["title"] !== "string" || obj["title"].length === 0) {
      reasons.push("title is required and must be non-empty");
    }

    if (typeof obj["description"] !== "string" || obj["description"].length === 0) {
      reasons.push("description is required and must be non-empty");
    }

    if (reasons.length > 0) {
      failures.push({ file, reasons });
    } else {
      console.log(`[schemas:lint] ✓ ${file}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[schemas:lint] ${failures.length} of ${files.length} schemas failed:\n`);
    for (const f of failures) {
      console.error(`  ✗ ${f.file}`);
      for (const r of f.reasons) {
        console.error(`    - ${r}`);
      }
    }
    process.exit(1);
  }

  console.log(`\n[schemas:lint] ${files.length}/${files.length} schemas valid.`);
}

main().catch((err) => {
  console.error("[schemas:lint] FAILED");
  console.error(err);
  process.exit(1);
});
