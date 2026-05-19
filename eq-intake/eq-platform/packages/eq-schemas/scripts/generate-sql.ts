/**
 * scripts/generate-sql.ts — JSON Schema → PostgreSQL CREATE TABLE per entity.
 *
 * Sibling of generate.ts. Walks every schema in src/schemas/, emits a
 * CREATE TABLE per `x-eq-entity` to src/generated/sql/<entity>.sql.
 *
 * Output is idempotent (`create table if not exists`) so the migration
 * sequencer can re-run it safely. RLS is enabled per table; policies
 * are intentionally NOT created here (002_intake_module_columns.sql
 * handles the cross-table tenant_id columns + indexes; per-tenant RLS
 * policies live in a separate migration when we're ready).
 *
 * Column mapping rules:
 *   - string                  → text
 *   - string + format=uuid    → uuid
 *   - string + format=date    → date
 *   - string + format=date-time→ timestamptz
 *   - string + maxLength      → varchar(N)
 *   - number / integer        → numeric / bigint
 *   - boolean                 → boolean
 *   - <entity>_id (PK)        → uuid primary key default gen_random_uuid()
 *   - tenant_id               → uuid not null + indexed
 *   - field with x-eq-foreign-key → adds REFERENCES + index
 *   - required (and not x-eq-required-on-import=false) → not null
 *   - type: ["X", "null"]     → nullable
 *
 * Order: tables are emitted alphabetically by entity name. Foreign-key
 * targets are emitted via `create table if not exists` first if they
 * aren't already in the same file (handles forward references — the
 * migration sequencer runs all tables together).
 */

import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const PKG_ROOT = resolve(process.cwd());
const SCHEMAS_DIR = join(PKG_ROOT, "src", "schemas");
const OUT_DIR = join(PKG_ROOT, "src", "generated", "sql");

interface FieldSchema {
  type?: string | string[];
  format?: string;
  description?: string;
  maxLength?: number;
  minLength?: number;
  default?: unknown;
  enum?: unknown[];
  "x-eq-foreign-key"?: string;
  "x-eq-required-on-import"?: boolean;
  "x-eq-system-managed"?: boolean;
  "x-eq-coerce"?: string;
}

interface Schema {
  $id?: string;
  title?: string;
  "x-eq-entity": string;
  "x-eq-table"?: string;
  "x-eq-primary-key"?: string;
  "x-eq-version"?: string;
  required?: string[];
  properties: Record<string, FieldSchema>;
}

// Audit columns appended after the schema's own properties. Skipped per-column
// if the schema already declared them (otherwise Postgres errors on duplicate).
const AUDIT_COLUMNS: Array<[name: string, definition: string]> = [
  ["imported_at", "imported_at timestamptz"],
  ["imported_from", "imported_from text"],
  ["intake_id", "intake_id uuid"],
  ["schema_version", "schema_version text"],
  ["created_at", "created_at timestamptz not null default now()"],
  ["updated_at", "updated_at timestamptz not null default now()"],
  ["created_by", "created_by uuid"],
  ["updated_by", "updated_by uuid"],
];

async function main() {
  const all = await readdir(SCHEMAS_DIR);
  const files = all.filter((f) => f.endsWith(".schema.json")).sort();
  if (files.length === 0) {
    console.error(`[sql] No *.schema.json files in ${SCHEMAS_DIR}`);
    process.exit(1);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // First pass: build entity → table name map so FK emission can pluralise
  // (schemas declare FKs as "<entity>.<col>" using singular entity names,
  // but the actual table name comes from x-eq-table which is usually plural).
  const entityToTable = new Map<string, string>();
  const parsed: { file: string; schema: Schema }[] = [];
  for (const file of files) {
    const raw = await readFile(join(SCHEMAS_DIR, file), "utf8");
    const schema = JSON.parse(raw) as Schema;
    const entity = schema["x-eq-entity"];
    const tableName = schema["x-eq-table"] ?? entity;
    entityToTable.set(entity, tableName);
    parsed.push({ file, schema });
  }

  const allTables: {
    entity: string;
    tableName: string;
    tableSql: string;
    alterSql: string;
  }[] = [];

  for (const { file, schema } of parsed) {
    const entity = schema["x-eq-entity"];
    const tableName = schema["x-eq-table"] ?? entity;
    const { tableSql, alterSql } = emitCreateTable(schema, tableName, entityToTable);
    allTables.push({ entity, tableName, tableSql, alterSql });
    // Per-entity file: CREATE then ALTER, so it stays self-contained if applied
    // standalone in a context where FK targets already exist.
    await writeFile(
      join(OUT_DIR, `${entity}.sql`),
      tableSql + (alterSql ? "\n" + alterSql : ""),
      "utf8",
    );
    console.log(`[sql] ${file} -> ${entity}.sql (table: ${tableName})`);
  }

  // Combined "all tables" file the sequencer applies in one go. CREATE TABLEs
  // come first so all referenced tables exist before any FK is added. ALTERs
  // are emitted in a second pass at the bottom.
  const alterBlocks = allTables
    .filter((t) => t.alterSql)
    .map((t) => `-- FKs for ${t.entity}\n${t.alterSql}`)
    .join("\n");
  const combined = [
    "-- AUTO-GENERATED. DO NOT EDIT.",
    "-- Combined CREATE TABLE for every canonical entity in @eq/schemas.",
    "-- Run BEFORE 001_intake_spine.sql (002 references these tables).",
    "",
    `set search_path = public;`,
    "",
    "-- Required Postgres extensions (Supabase has these enabled by default)",
    "create extension if not exists pgcrypto;",
    "",
    ...allTables.map((t) => `-- ----- ${t.entity} -----\n${t.tableSql}`),
    ...(alterBlocks
      ? [
          "-- ----- foreign keys (deferred until all tables exist) -----",
          alterBlocks,
        ]
      : []),
  ].join("\n");
  await writeFile(join(OUT_DIR, "_all_tables.sql"), combined, "utf8");
  console.log(`[sql] Combined -> _all_tables.sql (${allTables.length} tables)`);
}

function emitCreateTable(
  schema: Schema,
  tableName: string,
  entityToTable: Map<string, string>,
): { tableSql: string; alterSql: string } {
  const lines: string[] = [];
  lines.push(`create table if not exists ${tableName} (`);

  const columnDefs: string[] = [];
  // FK constraints are emitted as deferred ALTER TABLE statements so the
  // combined sequencer can create all tables first, regardless of FK order.
  const alters: string[] = [];
  const indexes: string[] = [];
  const required = new Set(schema.required ?? []);
  const entity = schema["x-eq-entity"];
  const pkColumn = schema["x-eq-primary-key"] ?? `${entity}_id`;
  const emitted = new Set<string>();

  for (const [name, field] of Object.entries(schema.properties)) {
    const colDef = emitColumn(name, field, required.has(name), pkColumn);
    columnDefs.push(`  ${colDef}`);
    emitted.add(name);

    // Enum CHECK as deferred ALTER — the inline CHECK in CREATE TABLE only
    // applies on fresh creates. For existing tables, `create table if not
    // exists` is a no-op and the new CHECK never gets added. Emit a deferred
    // drop-then-add so re-runs land the constraint on existing tables too.
    const colSqlType = pickSqlType(field, name === pkColumn);
    const enumValues = field.enum;
    const isCheckableEnumType =
      colSqlType === "text" ||
      colSqlType.startsWith("varchar") ||
      colSqlType === "bigint" ||
      colSqlType === "numeric" ||
      colSqlType === "date" ||
      colSqlType === "timestamptz";
    if (
      Array.isArray(enumValues) &&
      enumValues.length > 0 &&
      isCheckableEnumType &&
      name !== pkColumn
    ) {
      const scalarValues = enumValues.filter((v) => v !== null);
      if (scalarValues.length > 0) {
        const sqlLiterals = scalarValues
          .map((v) => `'${String(v).replace(/'/g, "''")}'`)
          .join(", ");
        const conName = `${tableName}_${name}_enum_check`;
        alters.push(
          `alter table ${tableName} drop constraint if exists ${conName};`,
        );
        alters.push(
          `alter table ${tableName} add constraint ${conName} check (${name} is null or ${name} in (${sqlLiterals}));`,
        );
      }
    }

    // FK constraint — only emit when:
    //   (a) target entity is a known schema (resolves to a real table), AND
    //   (b) the source column SQL type is uuid (scalar refs only — array-of-uuid
    //       lives in jsonb and would need a join table, not a column FK).
    // Emitted as drop-then-add so re-runs are idempotent (Postgres has no
    // `add constraint if not exists`).
    const fk = field["x-eq-foreign-key"];
    if (fk) {
      const [refEntity, refColumn] = fk.split(".");
      const refTable = refEntity ? entityToTable.get(refEntity) : undefined;
      const isUuidColumn = pickSqlType(field, name === pkColumn) === "uuid";
      if (refTable && refColumn && isUuidColumn) {
        const conName = `${tableName}_${name}_fk`;
        alters.push(
          `alter table ${tableName} drop constraint if exists ${conName};`,
        );
        alters.push(
          `alter table ${tableName} add constraint ${conName} foreign key (${name}) references ${refTable}(${refColumn});`,
        );
        indexes.push(
          `create index if not exists ${tableName}_${name}_idx on ${tableName}(${name});`,
        );
      } else if (refEntity && !refTable) {
        console.warn(
          `[sql] ${tableName}.${name}: FK target entity "${refEntity}" has no schema — skipping constraint`,
        );
      } else if (!isUuidColumn) {
        console.warn(
          `[sql] ${tableName}.${name}: FK on non-uuid column (${pickSqlType(field, false)}) — skipping constraint`,
        );
      }
    }

    // tenant_id always indexed (every RLS-scoped lookup uses it)
    if (name === "tenant_id") {
      indexes.push(
        `create index if not exists ${tableName}_tenant_id_idx on ${tableName}(tenant_id);`,
      );
    }
  }

  // Audit columns common to all canonical tables — skip any the schema
  // already declared (otherwise Postgres errors on duplicate column).
  for (const [name, definition] of AUDIT_COLUMNS) {
    if (!emitted.has(name)) {
      columnDefs.push(`  ${definition}`);
    }
  }

  lines.push(columnDefs.join(",\n"));
  lines.push(");");

  for (const idx of indexes) {
    lines.push(idx);
  }

  // Enable RLS on every table (policies declared separately)
  lines.push(`alter table ${tableName} enable row level security;`);

  return {
    tableSql: lines.join("\n") + "\n",
    alterSql: alters.join("\n") + (alters.length > 0 ? "\n" : ""),
  };
}

function emitColumn(
  name: string,
  field: FieldSchema,
  isRequired: boolean,
  pkColumn: string,
): string {
  const isPk = name === pkColumn;
  const sqlType = pickSqlType(field, isPk);
  const isNullable = nullable(field, isRequired);

  let line = `${name} ${sqlType}`;

  if (isPk) {
    line += ` primary key default gen_random_uuid()`;
  } else if (!isNullable) {
    line += ` not null`;
  }

  // Defaults — only literal scalars; complex defaults need migration scripts
  if (field.default !== undefined && !isPk) {
    if (typeof field.default === "boolean") {
      line += ` default ${field.default}`;
    } else if (typeof field.default === "number") {
      line += ` default ${field.default}`;
    } else if (typeof field.default === "string") {
      line += ` default '${field.default.replace(/'/g, "''")}'`;
    }
  }

  // Enum CHECK constraint — JSON Schema `enum` becomes a Postgres CHECK so the
  // DB enforces the allowed set, not just the validate pipeline. The constraint
  // permits NULL explicitly (Postgres NULL is unknown; a check returning NULL
  // doesn't reject the row, but being explicit reads clearer). JSON Schema
  // sometimes includes `null` in enum values to signal nullability — strip
  // those, the null branch handles them. Skip enum CHECK for jsonb/boolean/uuid
  // (jsonb can't reasonably constrain to a scalar set; boolean is already
  // constrained; uuids don't have meaningful enum sets in EQ schemas).
  const enumValues = field.enum;
  const isCheckableType =
    sqlType === "text" ||
    sqlType.startsWith("varchar") ||
    sqlType === "bigint" ||
    sqlType === "numeric" ||
    sqlType === "date" ||
    sqlType === "timestamptz";
  if (
    Array.isArray(enumValues) &&
    enumValues.length > 0 &&
    isCheckableType &&
    !isPk
  ) {
    const scalarValues = enumValues.filter((v) => v !== null);
    if (scalarValues.length > 0) {
      const sqlLiterals = scalarValues
        .map((v) => `'${String(v).replace(/'/g, "''")}'`)
        .join(", ");
      line += ` check (${name} is null or ${name} in (${sqlLiterals}))`;
    }
  }

  return line;
}

function pickSqlType(field: FieldSchema, isPk: boolean): string {
  if (isPk) return "uuid";

  const t = Array.isArray(field.type) ? field.type.filter((x) => x !== "null")[0] : field.type;

  if (t === "boolean") return "boolean";
  if (t === "integer") return "bigint";
  if (t === "number") return "numeric";

  if (t === "string") {
    if (field.format === "uuid") return "uuid";
    if (field.format === "date") return "date";
    if (field.format === "date-time" || field.format === "datetime") return "timestamptz";
    if (field.format === "email") return "text";
    if (field.format === "uri") return "text";
    if (field.maxLength != null && field.maxLength <= 255) {
      return `varchar(${field.maxLength})`;
    }
    return "text";
  }

  // Unknown / array / object — store as jsonb for forward compat
  return "jsonb";
}

function nullable(field: FieldSchema, isRequired: boolean): boolean {
  // Explicit null in the type array → nullable
  if (Array.isArray(field.type) && field.type.includes("null")) return true;
  // Required-on-import=false fields are nullable in the DB too (system fills them)
  if (field["x-eq-required-on-import"] === false) return true;
  // System-managed fields are nullable (filled at insert time)
  if (field["x-eq-system-managed"]) return true;
  // Required + not nullable
  return !isRequired;
}

main().catch((e) => {
  console.error("[sql] generate failed:", e);
  process.exit(1);
});
