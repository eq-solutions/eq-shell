/**
 * commit-canonical — bundle → canonical per-tenant tables, with audit trail.
 *
 * Takes a SimPRO bundle (parsed customer + site + contact sheets) and:
 *   1. Per entity, in FK order (customer → site → contact):
 *      a. Creates an eq_intake_events row on shared (shell_control)
 *         (status: 'committing'), returns intake_id.
 *      b. Maps source columns → canonical fields via x-eq-source-aliases.
 *      c. Validates against the canonical JSON Schema (`@eq/validation`'s
 *         validate()) — produces valid_rows + flagged_rows + rejected_rows.
 *      d. Resolves cross-batch FKs: sites/contacts both have customer_id
 *         that must point at a real customer UUID. We use the customer
 *         row's external_id (SimPRO Customer ID) as the join key. The
 *         (external_id → customer_id) map comes back from the orchestrator
 *         response as `fk_lookup` on the customers commit — no second
 *         tenant-DB read.
 *      e. POSTs to /.netlify/functions/intake-commit, which routes to the
 *         caller's per-tenant data plane and calls
 *         eq_intake_commit_batch_<module>(...). The orchestrator is
 *         session-authed via the eq_shell_session cookie sent
 *         credentials: 'same-origin' from the Shell-hosted UI.
 *      f. Updates the eq_intake_events row to 'completed' or 'failed'.
 *
 *   2. Returns a per-entity result with committed_count, rejected rows,
 *      and the intake_ids so the UI can render the audit trail.
 *
 * Pre-cutover (before 2026-05-24) this called
 * `supabase.rpc('eq_intake_commit_batch')` directly against shared
 * eq-canonical's app_data, and `buildCustomerIdMap()` read back the
 * customers table via the same client. After the Phase 2.B.6 cutover
 * (PRs #25/#28/#29/#30/#31) data lives on per-tenant DBs that the
 * browser has no direct client for. The orchestrator + fk_lookup
 * response close that loop.
 *
 * The Supabase client type is kept structural (SupabaseLikeClient interface
 * below) so this package doesn't take a hard dependency on
 * `@supabase/supabase-js`. It's used only for eq_intake_events lifecycle
 * (writes to shell_control on shared) and auth.getUser() — the actual
 * data commit goes via fetch.
 */

import { validate } from "@eq/validation";
import type { ParsedSheet } from "@eq/intake";

// Real canonical JSON Schemas (the same ones used to generate the DB tables).
// Imported as JSON modules — Vite + tsc both handle this via resolveJsonModule.
import customerJsonSchema from "@eq/schemas/schemas/customer.schema.json";
import contactJsonSchema from "@eq/schemas/schemas/contact.schema.json";
import siteJsonSchema from "@eq/schemas/schemas/site.schema.json";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SupabaseLikeClient {
  from: (table: string) => {
    insert: (row: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
    update: (row: unknown) => {
      eq: (
        col: string,
        val: unknown,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
}

/**
 * Response shape from /.netlify/functions/intake-commit. Mirrors the
 * CommitOk interface declared server-side in netlify/functions/intake-commit.ts.
 * `fk_lookup` is only populated by the 'core' module's customers batch.
 */
interface IntakeCommitOkResponse {
  ok:               true;
  module:           string;
  committed_count:  number;
  committed_ids:    string[];
  fk_lookup?:       Record<string, string>;
}

interface IntakeCommitErrResponse {
  ok:     false;
  error:  string;
  detail?: string;
}

type IntakeCommitResponse = IntakeCommitOkResponse | IntakeCommitErrResponse;

export type CanonicalEntity = "customer" | "site" | "contact";

export interface BundleSheets {
  customer?: ParsedSheet;
  site?: ParsedSheet;
  contact?: ParsedSheet;
}

export interface EntityCommitResult {
  entity: CanonicalEntity;
  table: string;
  intakeId: string | null;
  committedCount: number;
  flaggedCount: number;
  rejectedCount: number;
  /** Per-row rejection reasons for the operator to see. */
  rejectedRows: Array<{ source_row_index: number; reasons: string[] }>;
  /** If the whole entity commit failed (HTTP / network / RPC), the message. */
  fatalError?: string;
  /**
   * Only set on the 'customer' entity result: { external_id: customer_id }
   * map returned by the orchestrator. Used internally to resolve site/
   * contact FKs in the next batches; surfaced on the result for callers
   * that want to inspect it.
   */
  fkLookup?: Record<string, string>;
}

export interface CommitOptions {
  supabase: SupabaseLikeClient;
  bundle: BundleSheets;
  tenantId: string;
  /** Filename to surface in eq_intake_events.source_filename — for the audit. */
  sourceFilename?: string;
  /** Override schemas — useful for testing. Production callers pass nothing. */
  schemas?: Partial<Record<CanonicalEntity, JsonSchema>>;
}

export interface CommitResult {
  bundleSuccess: boolean;
  perEntity: EntityCommitResult[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface JsonSchema {
  $id?: string;
  "x-eq-entity": string;
  "x-eq-table"?: string;
  "x-eq-primary-key"?: string;
  "x-eq-version"?: string;
  required?: string[];
  properties: Record<string, JsonSchemaField>;
}

interface JsonSchemaField {
  type?: string | string[];
  format?: string;
  "x-eq-source-aliases"?: string[];
  "x-eq-foreign-key"?: string;
  "x-eq-system-managed"?: boolean;
  [k: string]: unknown;
}

const CANONICAL_SCHEMAS: Record<CanonicalEntity, JsonSchema> = {
  customer: customerJsonSchema as unknown as JsonSchema,
  site: siteJsonSchema as unknown as JsonSchema,
  contact: contactJsonSchema as unknown as JsonSchema,
};

const ENTITY_TABLE: Record<CanonicalEntity, string> = {
  customer: "customers",
  site: "sites",
  contact: "contacts",
};

// FK resolution order — sites and contacts both reference customer.customer_id,
// so customers commit first and we cache their (external_id → customer_id) map.
const COMMIT_ORDER: CanonicalEntity[] = ["customer", "site", "contact"];

// ---------------------------------------------------------------------------
// Mapping inference
// ---------------------------------------------------------------------------

/**
 * Build a source-header → canonical-field mapping by matching each header
 * against every field's `x-eq-source-aliases`. Falls back to a normalised
 * name match (lowercase, underscores) for fields the schema author didn't
 * list as an alias.
 */
export function inferMapping(
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
    // Also let the canonical field name itself match a normalised header.
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
// Error formatting
// ---------------------------------------------------------------------------

/**
 * Turn a ValidationError discriminated union into a human-readable string
 * for the rejected-rows UI. Each variant has different secondary keys —
 * most have `field`, some have rule_id / value / allowed / expected. We
 * surface what's there without claiming what isn't.
 */
function formatValidationError(e: {
  kind: string;
  field?: string;
  rule_id?: string;
  message?: string;
  reason?: string;
  value?: unknown;
  allowed?: string[];
  expected?: string;
  got?: unknown;
  format?: string;
}): string {
  const where = e.field ?? e.rule_id ?? "(row)";
  if (e.message) return `${e.kind} on ${where}: ${e.message}`;
  if (e.reason) return `${e.kind} on ${where}: ${e.reason}`;
  if (e.allowed && Array.isArray(e.allowed)) {
    return `${e.kind} on ${where}: expected one of ${e.allowed.join(", ")}`;
  }
  if (e.expected) return `${e.kind} on ${where}: expected ${e.expected}, got ${String(e.got)}`;
  if (e.format) return `${e.kind} on ${where}: expected format ${e.format}`;
  return `${e.kind} on ${where}`;
}

// ---------------------------------------------------------------------------
// eq_intake_events lifecycle
// ---------------------------------------------------------------------------

interface CreateIntakeEventArgs {
  supabase: SupabaseLikeClient;
  tenantId: string;
  createdBy: string;
  entity: CanonicalEntity;
  schemaVersion: string;
  sourceFilename?: string;
  sourceKind?: string;
}

async function createIntakeEvent(args: CreateIntakeEventArgs): Promise<string> {
  // Generate UUID client-side so we can pass it to commit_batch.
  // crypto.randomUUID() is available in modern browsers + Node 19+.
  const intakeId = crypto.randomUUID();
  const { error } = await args.supabase.from("eq_intake_events").insert({
    intake_id: intakeId,
    tenant_id: args.tenantId,
    entity: args.entity,
    source_kind: args.sourceKind ?? "import_spreadsheet",
    source_filename: args.sourceFilename ?? null,
    schema_version: args.schemaVersion,
    status: "committing",
    created_by: args.createdBy,
    import_mode: "append",
  });
  if (error) {
    throw new Error(`Failed to create intake event for ${args.entity}: ${error.message}`);
  }
  return intakeId;
}

interface FinishIntakeEventArgs {
  supabase: SupabaseLikeClient;
  intakeId: string;
  status: "completed" | "failed";
  rowsCommitted: number;
  rowsFlagged: number;
  rowsRejected: number;
  errorMessage?: string;
}

async function finishIntakeEvent(args: FinishIntakeEventArgs): Promise<void> {
  const patch: Record<string, unknown> = {
    status: args.status,
    rows_committed: args.rowsCommitted,
    rows_flagged: args.rowsFlagged,
    rows_rejected: args.rowsRejected,
    completed_at: new Date().toISOString(),
  };
  if (args.errorMessage) patch.error_message = args.errorMessage;
  const { error } = await args.supabase
    .from("eq_intake_events")
    .update(patch)
    .eq("intake_id", args.intakeId);
  if (error) {
    // Don't throw — the data is already committed; logging this is best-effort.
    // eslint-disable-next-line no-console
    console.warn(`Failed to finalise intake event ${args.intakeId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// FK resolution between batches
// ---------------------------------------------------------------------------

/**
 * Apply a customerId map to a list of pre-validation rows. Each row's
 * external_customer_id (from SimPRO) gets translated into customer_id
 * (canonical UUID). Rows whose external_customer_id isn't in the map are
 * left alone — validate() will surface them as missing-FK rejections.
 *
 * SimPRO multi-customer cells like "31, 32, 208" use the first ID as
 * primary (matches today's generate-quotes-csv.mjs fix). Linked IDs are
 * not surfaced to canonical today; they live on the export rollup.
 */
function resolveCustomerFk(
  rows: Record<string, unknown>[],
  customerIdMap: Map<string, string>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out = { ...row };
    const externalCustomerId = String(
      row["external_customer_id"] ?? row["simPRO Customer ID"] ?? "",
    ).trim();
    if (!externalCustomerId) return out;
    // Multi-customer cell: "31, 32, 208" → take the first.
    const firstId = externalCustomerId.split(",")[0]?.trim();
    if (!firstId) return out;
    const customerId = customerIdMap.get(firstId);
    if (customerId) {
      out["customer_id"] = customerId;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Per-entity commit
// ---------------------------------------------------------------------------

interface CommitOneEntityArgs {
  supabase: SupabaseLikeClient;
  entity: CanonicalEntity;
  schema: JsonSchema;
  sheet: ParsedSheet;
  tenantId: string;
  createdBy: string;
  sourceFilename?: string;
  customerIdMap?: Map<string, string>;
}

async function commitOneEntity(args: CommitOneEntityArgs): Promise<EntityCommitResult> {
  const table = args.schema["x-eq-table"] ?? ENTITY_TABLE[args.entity];
  const schemaVersion = args.schema["x-eq-version"] ?? "1.0.0";

  // Audit-row first — even if validation rejects every row, we want a
  // record that "this intake was attempted at this time".
  let intakeId: string;
  try {
    intakeId = await createIntakeEvent({
      supabase: args.supabase,
      tenantId: args.tenantId,
      createdBy: args.createdBy,
      entity: args.entity,
      schemaVersion,
      sourceFilename: args.sourceFilename,
    });
  } catch (e) {
    return {
      entity: args.entity,
      table,
      intakeId: null,
      committedCount: 0,
      flaggedCount: 0,
      rejectedCount: args.sheet.rows.length,
      rejectedRows: [],
      fatalError: e instanceof Error ? e.message : String(e),
    };
  }

  // Resolve customer FKs for site/contact before validation, so the
  // resulting `customer_id` column lands in the canonical rows.
  let preValidatedRows = args.sheet.rows as Record<string, unknown>[];
  if ((args.entity === "site" || args.entity === "contact") && args.customerIdMap) {
    preValidatedRows = resolveCustomerFk(preValidatedRows, args.customerIdMap);
  }

  // Header → canonical field mapping via x-eq-source-aliases.
  // Add `customer_id` as an identity mapping if we just stamped it during
  // resolveCustomerFk (it's not in the source headers but is in the row).
  const mapping = inferMapping(args.sheet.headerRow, args.schema);
  if (
    (args.entity === "site" || args.entity === "contact") &&
    !Object.values(mapping).includes("customer_id") &&
    preValidatedRows.some((r) => r["customer_id"] !== undefined)
  ) {
    mapping["customer_id"] = "customer_id";
  }

  // validate() against the canonical schema. We turn off allowNonCurrentSchema
  // because we just wrote the schema to the DB; the schema we have IS current.
  let validationResult;
  try {
    validationResult = await validate({
      schema: args.schema as unknown as Parameters<typeof validate>[0]["schema"],
      mapping,
      rows: preValidatedRows,
      tenantId: args.tenantId,
      allowNonCurrentSchema: true, // demo intake — don't fight the schema registry yet
    });
  } catch (e) {
    await finishIntakeEvent({
      supabase: args.supabase,
      intakeId,
      status: "failed",
      rowsCommitted: 0,
      rowsFlagged: 0,
      rowsRejected: args.sheet.rows.length,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return {
      entity: args.entity,
      table,
      intakeId,
      committedCount: 0,
      flaggedCount: 0,
      rejectedCount: args.sheet.rows.length,
      rejectedRows: [],
      fatalError: e instanceof Error ? e.message : String(e),
    };
  }

  const toCommit = [
    ...validationResult.valid_rows.map((r) => r.canonical),
    ...validationResult.flagged_rows.map((r) => r.canonical),
  ];

  if (toCommit.length === 0) {
    // Nothing to commit — close the audit row as completed with zero rows.
    await finishIntakeEvent({
      supabase: args.supabase,
      intakeId,
      status: "completed",
      rowsCommitted: 0,
      rowsFlagged: validationResult.summary.flagged,
      rowsRejected: validationResult.summary.rejected,
    });
    return {
      entity: args.entity,
      table,
      intakeId,
      committedCount: 0,
      flaggedCount: validationResult.summary.flagged,
      rejectedCount: validationResult.summary.rejected,
      rejectedRows: validationResult.rejected_rows.map((r) => ({
        source_row_index: r.source_row_index,
        reasons: r.errors.map(formatValidationError),
      })),
    };
  }

  // POST to the per-tenant intake orchestrator. Same-origin call from the
  // Shell-hosted UI; the eq_shell_session cookie rides along and gives
  // the orchestrator the tenant_id (it does NOT trust the p_tenant_id
  // we pass in here — kept for parity with the prior RPC shape but
  // ignored server-side, which is fine).
  let commitData: IntakeCommitResponse;
  let fatalErr: string | null = null;
  try {
    const res = await fetch("/.netlify/functions/intake-commit", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intake_id:      intakeId,
        table,
        rows:           toCommit,
        source_sig:     args.sourceFilename ?? `intake-${intakeId}`,
        schema_version: schemaVersion,
        import_mode:    "append",
      }),
    });
    commitData = (await res.json()) as IntakeCommitResponse;
    if (!res.ok || !commitData.ok) {
      fatalErr = !commitData.ok
        ? `${commitData.error}${commitData.detail ? `: ${commitData.detail}` : ""}`
        : `HTTP ${res.status}`;
    }
  } catch (e) {
    fatalErr = e instanceof Error ? e.message : String(e);
    commitData = { ok: false, error: "fetch_failed", detail: fatalErr };
  }

  if (fatalErr) {
    await finishIntakeEvent({
      supabase: args.supabase,
      intakeId,
      status: "failed",
      rowsCommitted: 0,
      rowsFlagged: validationResult.summary.flagged,
      rowsRejected: validationResult.summary.rejected,
      errorMessage: fatalErr,
    });
    return {
      entity: args.entity,
      table,
      intakeId,
      committedCount: 0,
      flaggedCount: validationResult.summary.flagged,
      rejectedCount: validationResult.summary.rejected + toCommit.length,
      rejectedRows: validationResult.rejected_rows.map((r) => ({
        source_row_index: r.source_row_index,
        reasons: r.errors.map(formatValidationError),
      })),
      fatalError: fatalErr,
    };
  }

  // fatalErr was null → commitData is the ok variant.
  const okData = commitData as IntakeCommitOkResponse;
  const committedCount = okData.committed_count;
  // fk_lookup is only populated for the 'core' module's customers commit.
  // Sites/contacts batches get an empty object or undefined.
  const fkLookup = okData.fk_lookup;

  await finishIntakeEvent({
    supabase: args.supabase,
    intakeId,
    status: "completed",
    rowsCommitted: committedCount,
    rowsFlagged: validationResult.summary.flagged,
    rowsRejected: validationResult.summary.rejected,
  });

  return {
    entity: args.entity,
    table,
    intakeId,
    committedCount,
    flaggedCount: validationResult.summary.flagged,
    rejectedCount: validationResult.summary.rejected,
    rejectedRows: validationResult.rejected_rows.map((r) => ({
      source_row_index: r.source_row_index,
      reasons: r.errors.map(formatValidationError),
    })),
    fkLookup,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function commitBundleToCanonical(opts: CommitOptions): Promise<CommitResult> {
  // Resolve the auth user once — used as created_by on every intake event.
  const userResp = await opts.supabase.auth.getUser();
  if (userResp.error || !userResp.data.user) {
    throw new Error(
      `Cannot commit canonical without an authenticated user: ${
        userResp.error?.message ?? "no user"
      }`,
    );
  }
  const createdBy = userResp.data.user.id;

  const perEntity: EntityCommitResult[] = [];
  let customerIdMap: Map<string, string> | undefined;
  let bundleSuccess = true;

  for (const entity of COMMIT_ORDER) {
    const sheet = opts.bundle[entity];
    if (!sheet) continue;
    const schema = opts.schemas?.[entity] ?? CANONICAL_SCHEMAS[entity];

    const result = await commitOneEntity({
      supabase: opts.supabase,
      entity,
      schema,
      sheet,
      tenantId: opts.tenantId,
      createdBy,
      sourceFilename: opts.sourceFilename,
      customerIdMap,
    });
    perEntity.push(result);

    if (result.fatalError) {
      bundleSuccess = false;
      // Stop the bundle early — later entities depend on earlier ones via FK.
      break;
    }

    // If we just committed customers, harvest the FK lookup from the
    // orchestrator's response for sites + contacts to consume. Pre-cutover
    // we did a second read against shared eq-canonical's customers table
    // here; post-cutover that data lives in the per-tenant DB and the
    // orchestrator returns the (external_id → customer_id) map inline.
    if (entity === "customer" && result.committedCount > 0 && result.fkLookup) {
      customerIdMap = new Map(Object.entries(result.fkLookup));
    }
  }

  return { bundleSuccess, perEntity };
}
