/**
 * scripts/fixture-smoke.ts — exercises the EQ Intake spine end-to-end
 * against the SimPRO fixtures in `simpro/` at the repo root.
 *
 * What this proves:
 *   1. `@eq/intake`'s parseFile() (auto-detect + Papa Parse) handles the
 *      real SimPRO CSV shape (quoted fields with commas, AU phone formats,
 *      DD/MM/YYYY dates, empty cells).
 *   2. `inferMapping()` (the helper from intake-demo's commit-canonical.ts)
 *      resolves SimPRO headers via `x-eq-source-aliases`.
 *   3. `@eq/validation`'s validate() coerces + checks against the canonical
 *      JSON Schemas (customer / contact / site), producing
 *      valid_rows + flagged_rows + rejected_rows.
 *
 * Output: a JSON-ish summary per fixture printed to stdout. No DB calls,
 * no auth, no commit — purely the parser → validation legs of the spine.
 *
 * Run:
 *   pnpm tsx scripts/fixture-smoke.ts
 *   (from eq-platform/)
 *
 * Optional args:
 *   --fixture <name>     limit to one of: customer | contact | site
 *   --limit <n>          parse only first N rows (default: all)
 *   --max-show <n>       max rejections / flags to print (default: 10)
 */

import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
// The script lives in eq-platform/scripts/ which has no workspace deps installed —
// import directly from each package's built dist/ to dodge module resolution.
// Build via `pnpm -r build` first if dist/ is missing.
import { parseFile } from "../packages/eq-intake/dist/index.js";
import { validate } from "../packages/eq-validation/dist/index.js";

// ---------------------------------------------------------------------------
// Inline copy of inferMapping() from intake-demo's commit-canonical.ts.
// That helper isn't exported from a workspace-published entry point — it
// lives in the demo app. Duplicating here keeps the script standalone and
// avoids dragging React deps into a node script.
// ---------------------------------------------------------------------------

interface JsonSchemaField {
  type?: string | string[];
  format?: string;
  "x-eq-source-aliases"?: string[];
  [k: string]: unknown;
}

interface JsonSchema {
  $id?: string;
  "x-eq-entity": string;
  "x-eq-table"?: string;
  "x-eq-version"?: string;
  required?: string[];
  properties: Record<string, JsonSchemaField>;
}

function inferMapping(
  headers: string[],
  schema: JsonSchema,
): Record<string, string | null> {
  const norm = (s: string): string =>
    s.toLowerCase().replace(/[\s\-./]+/g, "_").replace(/[^a-z0-9_]/g, "");
  const aliasIndex = new Map<string, string>();
  for (const [field, sub] of Object.entries(schema.properties)) {
    const aliases = sub["x-eq-source-aliases"] ?? [];
    for (const a of aliases) {
      aliasIndex.set(norm(a), field);
    }
    aliasIndex.set(norm(field), field);
  }
  const mapping: Record<string, string | null> = {};
  for (const h of headers) {
    const hit = aliasIndex.get(norm(h));
    mapping[h] = hit ?? null;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  fixtureFilter?: "customer" | "contact" | "site";
  limit?: number;
  maxShow: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { maxShow: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") {
      const v = argv[++i];
      if (v === "customer" || v === "contact" || v === "site") {
        out.fixtureFilter = v;
      } else {
        throw new Error(`--fixture must be customer|contact|site, got ${v}`);
      }
    } else if (a === "--limit") {
      out.limit = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(out.limit) || out.limit! <= 0) {
        throw new Error(`--limit must be a positive integer`);
      }
    } else if (a === "--max-show") {
      out.maxShow = Number.parseInt(argv[++i] ?? "", 10) || 10;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MONOREPO_ROOT = resolve(process.cwd());
const REPO_ROOT = resolve(MONOREPO_ROOT, "..");
const SCHEMAS_DIR = resolve(
  MONOREPO_ROOT,
  "packages",
  "eq-schemas",
  "src",
  "schemas",
);
const FIXTURES_DIR = resolve(REPO_ROOT, "simpro");

const FIXTURES: Array<{
  entity: "customer" | "contact" | "site";
  schemaFile: string;
  csvFile: string;
}> = [
  {
    entity: "customer",
    schemaFile: "customer.schema.json",
    csvFile: "customer_export_2026-05-15_042003.csv",
  },
  {
    entity: "contact",
    schemaFile: "contact.schema.json",
    csvFile: "customer_contacts_export_2026-05-15_042008.csv",
  },
  {
    entity: "site",
    schemaFile: "site.schema.json",
    csvFile: "site_export_2026-05-15_042020.csv",
  },
];

const TENANT = "00000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  for (const fixture of FIXTURES) {
    if (args.fixtureFilter && fixture.entity !== args.fixtureFilter) continue;

    const csvPath = resolve(FIXTURES_DIR, fixture.csvFile);
    const schemaPath = resolve(SCHEMAS_DIR, fixture.schemaFile);

    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as JsonSchema;
    const bytes = readFileSync(csvPath);

    const banner = `===== ${fixture.entity.toUpperCase()}  (${basename(csvPath)}) =====`;
    console.log("\n" + banner);

    // -------- 1. parseFile (auto-detect → CSV reader)
    const parsed = await parseFile({ bytes, fileName: fixture.csvFile });
    const sheet = parsed.sheets[0];
    if (!sheet) {
      console.log(`  parseFile returned no sheets — aborting this fixture.`);
      continue;
    }

    console.log(`  format detected:    ${parsed.format} (via ${parsed.meta.detectedFrom})`);
    console.log(`  encoding/delimiter: ${sheet.meta.encoding} / ${JSON.stringify(sheet.meta.delimiter)}`);
    console.log(`  bom detected:       ${sheet.meta.bomDetected}`);
    console.log(`  total rows parsed:  ${sheet.meta.totalRows}`);
    console.log(`  malformed rows:     ${sheet.meta.malformedRows}`);
    console.log(`  empty rows skipped: ${sheet.meta.emptyRowsSkipped}`);

    if (sheet.meta.malformed.length > 0) {
      console.log(`  malformed examples:`);
      for (const m of sheet.meta.malformed.slice(0, 3)) {
        console.log(`    line ${m.lineNumber}: ${m.reason} — ${m.message}`);
      }
    }

    // -------- 2. inferMapping
    const mapping = inferMapping(sheet.headerRow, schema);
    const mappedHeaders = Object.entries(mapping).filter(([, v]) => v !== null);
    const unmappedHeaders = Object.entries(mapping)
      .filter(([, v]) => v === null)
      .map(([h]) => h);

    console.log(`\n  headers in source: ${sheet.headerRow.length}`);
    console.log(`  mapped → canonical: ${mappedHeaders.length}`);
    console.log(`  unmapped source columns (${unmappedHeaders.length}):`);
    for (const h of unmappedHeaders) console.log(`    - ${h}`);

    // -------- 3. validate
    const rowsToValidate = args.limit
      ? sheet.rows.slice(0, args.limit)
      : sheet.rows;

    const result = await validate({
      schema: schema as unknown as Parameters<typeof validate>[0]["schema"],
      mapping,
      rows: rowsToValidate as Record<string, unknown>[],
      tenantId: TENANT,
      allowNonCurrentSchema: true,
    });

    console.log(`\n  validate() summary:`);
    console.log(`    total:    ${result.summary.total}`);
    console.log(`    valid:    ${result.summary.valid}`);
    console.log(`    flagged:  ${result.summary.flagged}`);
    console.log(`    rejected: ${result.summary.rejected}`);

    if (Object.keys(result.summary.by_field_errors).length > 0) {
      console.log(`    by_field_errors:`);
      const sorted = Object.entries(result.summary.by_field_errors).sort(
        (a, b) => b[1] - a[1],
      );
      for (const [field, count] of sorted) {
        console.log(`      ${field}: ${count}`);
      }
    }

    // First N rejections
    if (result.rejected_rows.length > 0) {
      console.log(
        `\n  first ${Math.min(args.maxShow, result.rejected_rows.length)} rejected rows:`,
      );
      for (const r of result.rejected_rows.slice(0, args.maxShow)) {
        const errs = r.errors
          .map((e) => {
            const where = "field" in e ? (e as { field?: string }).field : "rule_id" in e ? (e as { rule_id?: string }).rule_id : "(row)";
            const extra = JSON.stringify(
              Object.fromEntries(
                Object.entries(e as Record<string, unknown>).filter(
                  ([k]) => k !== "kind" && k !== "field" && k !== "rule_id",
                ),
              ),
            );
            return `${e.kind}@${where} ${extra}`;
          })
          .join("; ");
        console.log(`    row ${r.source_row_index}: ${errs}`);
      }
    }

    // First N flagged rows
    if (result.flagged_rows.length > 0) {
      console.log(
        `\n  first ${Math.min(args.maxShow, result.flagged_rows.length)} flagged rows:`,
      );
      for (const f of result.flagged_rows.slice(0, args.maxShow)) {
        const flags = f.flags
          .map((fl) => {
            const where = "field" in fl ? (fl as { field?: string }).field : "rule_id" in fl ? (fl as { rule_id?: string }).rule_id : "(row)";
            return `${fl.kind}@${where}`;
          })
          .join("; ");
        console.log(`    row ${f.source_row_index}: ${flags}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("fixture-smoke crashed:", e);
  process.exit(1);
});
