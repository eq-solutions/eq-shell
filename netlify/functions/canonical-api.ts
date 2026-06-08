// netlify/functions/canonical-api.ts
//
// The single read/write surface external apps (and refactored shell-side
// code) use to reach per-tenant data planes. Routes the request to the
// correct tenant Supabase project based on the X-Tenant header, opens a
// service-role client there, and runs the resource query.
//
// Authentication
//   Bearer key per calling app, kept in env vars:
//     CANONICAL_API_KEY_QUOTES     — quotes.eq.solutions (Flask)
//     CANONICAL_API_KEY_SERVICE    — eq-solves-service (Next.js)
//     CANONICAL_API_KEY_FIELD      — eq-solves-field (Netlify)
//     CANONICAL_API_KEY_CARDS      — eq-cards (Flutter web)
//     CANONICAL_API_KEY_SHELL      — internal shell refactor
//
//   Per-app keys (vs one shared key) let us revoke one consumer without
//   redeploying every other consumer. They also identify the caller in
//   logs without trusting a User-Agent string.
//
// Tenant identification
//   Header: X-Tenant: <slug>     (preferred)
//   Query:  ?tenant=<slug>       (fallback for HTMX/fetch-without-headers)
//
// Resources (initial set per ARCHITECTURE-V2.md Phase 2.B.3)
//   GET  ?resource=customers
//   GET  ?resource=contacts
//   GET  ?resource=sites
//   GET  ?resource=staff
//   GET  ?resource=licences
//   GET  ?resource=jobs
//   GET  ?resource=assets
//   GET  ?resource=asset_test_results
//   GET  ?resource=asset_defects
//   GET  ?resource=events            (poll canonical_events)
//   POST resource=events             (emit a canonical_event)
//
// Filters (GET, all optional)
//   limit=<n>                        max 500, default 100
//   offset=<n>                       default 0
//   active=true|false                where active = <value> if column exists
//   since=<iso>                      where updated_at|occurred_at >= <iso>
//   ids=<uuid>,<uuid>,...            where <pk> in (...)
//
// Response envelope
//   { ok: true, tenant, resource, total, limit, offset, data: [...] }
//   { ok: false, error: '<code>', detail?: '<human>' }
//
// Error codes: auth_failed | missing_tenant | invalid_tenant |
//              tenant_inactive | unknown_resource | invalid_filter |
//              method_not_allowed | rate_limited | internal_error
//
// Architecture: docs/ARCHITECTURE-V2.md "canonical-api design"

import type { Context } from '@netlify/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getTenantDataClient,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { withSentry } from './_shared/sentry.js';

// ──────────────────────────────────────────────────────────────────────
// Auth — bearer key per app
// ──────────────────────────────────────────────────────────────────────

interface AppIdentity {
  app: 'quotes' | 'service' | 'field' | 'cards' | 'shell';
}

const APP_KEY_ENV: Record<AppIdentity['app'], string> = {
  quotes:  'CANONICAL_API_KEY_QUOTES',
  service: 'CANONICAL_API_KEY_SERVICE',
  field:   'CANONICAL_API_KEY_FIELD',
  cards:   'CANONICAL_API_KEY_CARDS',
  shell:   'CANONICAL_API_KEY_SHELL',
};

function authenticateCaller(req: Request): AppIdentity | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const provided = m[1].trim();
  if (!provided) return null;
  for (const app of Object.keys(APP_KEY_ENV) as AppIdentity['app'][]) {
    const expected = process.env[APP_KEY_ENV[app]];
    if (expected && constantTimeEqual(provided, expected)) {
      return { app };
    }
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ──────────────────────────────────────────────────────────────────────
// Resource registry — single source of truth for what's exposed.
// ──────────────────────────────────────────────────────────────────────
//
// Each resource entry pins:
//   - table:   physical table in app_data
//   - pk:      primary key column (for ids= filter)
//   - select:  columns returned (explicit projection — never SELECT *)
//   - filterableActive: does the table have an `active` column
//   - sinceColumn: column to use for since= filter (defaults to updated_at)
//
// Adding a new resource = adding a row here. Keep projections tight; do
// not leak hourly_rate_cost, pin_hash, or other sensitive columns.

interface ResourceDef {
  table:             string;
  pk:                string;
  select:            string;
  filterableActive:  boolean;
  sinceColumn:       string;
}

const RESOURCES: Record<string, ResourceDef> = {
  customers: {
    table: 'customers',
    pk:    'customer_id',
    select: [
      'customer_id', 'tenant_id', 'external_id', 'type',
      'company_name', 'first_name', 'last_name', 'salutation',
      'abn', 'acn',
      'street_address', 'suburb', 'state', 'postcode', 'country',
      'postal_address', 'postal_suburb', 'postal_state', 'postal_postcode', 'postal_country',
      'primary_phone', 'mobile_phone', 'alt_phone', 'email', 'website',
      'customer_group', 'account_manager', 'currency',
      'active', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  contacts: {
    table: 'contacts',
    pk:    'contact_id',
    select: [
      'contact_id', 'tenant_id', 'customer_id', 'external_id', 'external_customer_id',
      'company_name', 'salutation', 'first_name', 'last_name',
      'email', 'work_phone', 'mobile_phone',
      'position', 'department',
      'is_default_quote_contact', 'is_default_job_contact',
      'is_default_invoice_contact', 'is_default_statement_contact',
      'active', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  sites: {
    table: 'sites',
    pk:    'site_id',
    select: [
      'site_id', 'tenant_id', 'external_id', 'customer_id', 'external_customer_id',
      'name', 'code', 'client_name', 'site_type', 'slug',
      'address_line_1', 'address_line_2', 'suburb', 'state', 'postcode', 'country',
      'latitude', 'longitude',
      'site_contact_name', 'site_contact_phone', 'site_contact_email',
      'induction_required', 'induction_url',
      'track_hours', 'budget_hours',
      'active', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  staff: {
    table: 'staff',
    pk:    'staff_id',
    // Note: hourly_rate_cost and hourly_rate_charge intentionally excluded
    // from the default projection. They are sensitive and shouldn't leave
    // the data plane casually. Add a separate `?include=rates` flag later
    // if a legitimate use case appears.
    select: [
      'staff_id', 'tenant_id', 'external_id',
      'first_name', 'last_name', 'preferred_name',
      'email', 'phone',
      'employment_type', 'trade', 'level',
      'start_date', 'end_date',
      'home_base', 'default_site_id',
      'date_of_birth', 'dob_day', 'dob_month',
      'address_street', 'address_suburb', 'address_state', 'address_postcode',
      'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_mobile',
      'tafe_day', 'year_level',
      'notify_roster', 'digest_opt_in',
      'active', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  licences: {
    table: 'licences',
    pk:    'licence_id',
    select: [
      'licence_id', 'tenant_id', 'staff_id', 'external_id',
      'licence_type', 'licence_number', 'issuing_authority', 'state',
      'issue_date', 'expiry_date',
      'photo_front_path', 'photo_back_path',
      'notes', 'metadata',
      'active', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  jobs: {
    table: 'jobs',
    pk:    'job_id',
    select: [
      'job_id', 'tenant_id', 'external_id',
      'customer_id', 'site_id', 'quote_id',
      'title', 'status',
      'started_at', 'target_completion',
      'created_at', 'updated_at',
    ].join(','),
    filterableActive: false,
    sinceColumn: 'updated_at',
  },
  assets: {
    table: 'assets',
    pk:    'asset_id',
    select: [
      'asset_id', 'tenant_id', 'external_id', 'site_id', 'parent_asset_id',
      'asset_type', 'name', 'make', 'model', 'serial_number', 'rating',
      'install_date', 'warranty_expires', 'criticality', 'condition',
      'service_schedule_id', 'ppm_frequency', 'last_service_date', 'next_service_due',
      'location_in_site', 'barcode', 'active', 'defects_summary',
      'client_classification', 'notes', 'cert_url', 'intake_id',
      'created_at', 'updated_at',
    ].join(','),
    filterableActive: true,
    sinceColumn: 'updated_at',
  },
  asset_test_results: {
    table: 'asset_test_results',
    pk:    'result_id',
    select: [
      'result_id', 'tenant_id', 'external_id', 'asset_id', 'visit_id',
      'test_type', 'test_date', 'tested_by_id', 'tested_by_external',
      'licence_number', 'pass_fail', 'raw_values', 'action_taken_if_fail',
      'test_cert_reference', 'notes', 'created_at', 'updated_at',
    ].join(','),
    filterableActive: false,
    sinceColumn: 'updated_at',
  },
  asset_defects: {
    table: 'asset_defects',
    pk:    'defect_id',
    select: [
      'defect_id', 'tenant_id', 'external_id', 'asset_id', 'visit_id',
      'raised_date', 'raised_by_id', 'severity', 'description', 'status',
      'resolution_date', 'resolved_by_id', 'resolution_notes',
      'estimated_cost', 'actual_cost', 'photo_attachments',
      'created_at', 'updated_at',
    ].join(','),
    filterableActive: false,
    sinceColumn: 'updated_at',
  },
  events: {
    table: 'canonical_events',
    pk:    'id',
    select: 'id, tenant_id, app_source, event, payload, occurred_at',
    filterableActive: false,
    sinceColumn: 'occurred_at',
  },
};

// ──────────────────────────────────────────────────────────────────────
// Response helpers
// ──────────────────────────────────────────────────────────────────────

interface OkBody {
  ok:        true;
  tenant:    string;
  resource:  string;
  total:     number | null;   // null when count not requested (we always request)
  limit:     number;
  offset:    number;
  data:      unknown[];
}

interface ErrorBody {
  ok:      false;
  error:   string;
  detail?: string;
}

function json(status: number, body: OkBody | ErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function err(status: number, code: string, detail?: string): Response {
  return json(status, { ok: false, error: code, ...(detail ? { detail } : {}) });
}

// ──────────────────────────────────────────────────────────────────────
// Filter parsing
// ──────────────────────────────────────────────────────────────────────

interface ParsedFilters {
  limit:   number;
  offset:  number;
  active?: boolean;
  since?:  string;
  ids?:    string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseFilters(url: URL): ParsedFilters | { error: string } {
  const limitRaw  = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');
  const activeRaw = url.searchParams.get('active');
  const sinceRaw  = url.searchParams.get('since');
  const idsRaw    = url.searchParams.get('ids');

  const limit  = limitRaw  ? parseInt(limitRaw, 10)  : 100;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
  if (!Number.isFinite(limit)  || limit  < 1 || limit  > 500) return { error: 'limit must be 1..500' };
  if (!Number.isFinite(offset) || offset < 0)                 return { error: 'offset must be >= 0' };

  let active: boolean | undefined;
  if (activeRaw !== null) {
    if (activeRaw === 'true')  active = true;
    else if (activeRaw === 'false') active = false;
    else return { error: 'active must be "true" or "false"' };
  }

  let since: string | undefined;
  if (sinceRaw !== null) {
    const d = new Date(sinceRaw);
    if (Number.isNaN(d.getTime())) return { error: 'since must be a valid ISO timestamp' };
    since = d.toISOString();
  }

  let ids: string[] | undefined;
  if (idsRaw !== null) {
    ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0)             return { error: 'ids cannot be empty' };
    if (ids.length > 100)             return { error: 'ids capped at 100 per request' };
    if (ids.some(id => !UUID_RE.test(id))) return { error: 'ids must all be valid UUIDs' };
  }

  return { limit, offset, active, since, ids };
}

// ──────────────────────────────────────────────────────────────────────
// GET handler
// ──────────────────────────────────────────────────────────────────────

async function handleGet(
  _req: Request,
  url: URL,
  caller: AppIdentity,
  tenantSlug: string,
): Promise<Response> {
  const resourceName = url.searchParams.get('resource');
  if (!resourceName) return err(400, 'unknown_resource', 'resource= query param is required');
  const def = RESOURCES[resourceName];
  if (!def) return err(400, 'unknown_resource', `unknown resource '${resourceName}'`);

  const parsed = parseFilters(url);
  if ('error' in parsed) return err(400, 'invalid_filter', parsed.error);

  let client: SupabaseClient<any, any, any>;
  try {
    client = await getTenantDataClient(tenantSlug);
  } catch (e) {
    return tenantError(e);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cAny = client as any;
  let query = cAny
    .schema('app_data')
    .from(def.table)
    .select(def.select, { count: 'exact' });

  if (def.filterableActive && parsed.active !== undefined) {
    query = query.eq('active', parsed.active);
  }
  if (parsed.since) {
    query = query.gte(def.sinceColumn, parsed.since);
  }
  if (parsed.ids) {
    query = query.in(def.pk, parsed.ids);
  }
  // canonical_events is naturally time-ordered; everything else by updated_at desc
  query = query.order(def.sinceColumn, { ascending: false });
  query = query.range(parsed.offset, parsed.offset + parsed.limit - 1);

  const { data, count, error } = await query;
  if (error) {
    console.error('[canonical-api] GET query failed', { app: caller.app, tenantSlug, resource: resourceName, error: error.message });
    return err(500, 'internal_error', error.message);
  }

  return json(200, {
    ok:       true,
    tenant:   tenantSlug,
    resource: resourceName,
    total:    typeof count === 'number' ? count : null,
    limit:    parsed.limit,
    offset:   parsed.offset,
    data:     data ?? [],
  });
}

// ──────────────────────────────────────────────────────────────────────
// PUT handler — upsert a canonical record by external_id
// ──────────────────────────────────────────────────────────────────────
//
// Body shape:
//   {
//     resource:    'customers' | 'sites' | 'contacts' | 'jobs' |
//                  'assets' | 'asset_test_results' | 'asset_defects',
//     external_id: string,          // upsert key (required)
//     ...fields                     // any writable columns for that resource
//   }
//
// Response:
//   { ok: true, tenant, resource, canonical_id: uuid, created: boolean }
//
// The upsert uses the service-role client (bypasses RLS) with explicit
// tenant_id from the routing layer — callers must not supply tenant_id in
// the body (it's silently stripped).
//
// Depends on unique partial indexes (tenant_id, external_id) WHERE external_id
// IS NOT NULL: customers, sites, contacts (migration 022); jobs (migration 040).
// ──────────────────────────────────────────────────────────────────────

// Allowed writable fields per resource.
// tenant_id and the PK are always stripped (never writable by callers).
// created_at / updated_at are managed by the database.
const WRITABLE_FIELDS: Record<string, Set<string>> = {
  customers: new Set([
    'external_id', 'type',
    'company_name', 'first_name', 'last_name', 'salutation',
    'abn', 'acn',
    'street_address', 'suburb', 'state', 'postcode', 'country',
    'postal_address', 'postal_suburb', 'postal_state', 'postal_postcode', 'postal_country',
    'primary_phone', 'mobile_phone', 'alt_phone', 'email', 'website',
    'customer_group', 'account_manager', 'currency',
    'active',
  ]),
  sites: new Set([
    'external_id', 'customer_id', 'external_customer_id',
    'name', 'code', 'client_name', 'site_type', 'slug',
    'address_line_1', 'address_line_2', 'suburb', 'state', 'postcode', 'country',
    'latitude', 'longitude',
    'site_contact_name', 'site_contact_phone', 'site_contact_email',
    'induction_required', 'induction_url',
    'track_hours', 'budget_hours',
    'active',
  ]),
  contacts: new Set([
    'external_id', 'customer_id', 'external_customer_id',
    'company_name', 'salutation', 'first_name', 'last_name',
    'email', 'work_phone', 'mobile_phone',
    'position', 'department',
    'is_default_quote_contact', 'is_default_job_contact',
    'is_default_invoice_contact', 'is_default_statement_contact',
    'active',
  ]),
  // The operational work-order spine. Written by the quote.accepted consumer
  // (quote-job-consumer) as external_id = 'eq-quotes:job:<quote_id>' so the
  // upsert is idempotent per quote. customer_id/site_id are canonical UUIDs;
  // quote_id is the soft link back to the originating quote. jobs has no `active`
  // column (filterableActive is false in RESOURCES), so it is not writable here.
  jobs: new Set([
    'external_id', 'customer_id', 'site_id', 'quote_id',
    'title', 'status', 'started_at', 'target_completion',
  ]),
  assets: new Set([
    'external_id', 'site_id', 'parent_asset_id',
    'asset_type', 'name', 'make', 'model', 'serial_number', 'rating',
    'install_date', 'warranty_expires', 'criticality', 'condition',
    'service_schedule_id', 'ppm_frequency', 'last_service_date', 'next_service_due',
    'location_in_site', 'barcode', 'active', 'defects_summary',
    'client_classification', 'notes', 'cert_url',
  ]),
  // For the asset child resources, asset_id is the canonical UUID FK — the caller
  // threads it from the asset upsert response; *_by_id resolve via staff. visit_id
  // is intentionally NOT writable: there is no visits resource to resolve it from
  // an external id yet, so accepting it would only invite NULL / wrong values.
  asset_test_results: new Set([
    'external_id', 'asset_id',
    'test_type', 'test_date', 'tested_by_id', 'tested_by_external',
    'licence_number', 'pass_fail', 'raw_values', 'action_taken_if_fail',
    'test_cert_reference', 'notes',
  ]),
  asset_defects: new Set([
    'external_id', 'asset_id',
    'raised_date', 'raised_by_id', 'severity', 'description', 'status',
    'resolution_date', 'resolved_by_id', 'resolution_notes',
    'estimated_cost', 'actual_cost', 'photo_attachments',
  ]),
};

// Resource → primary key column name (returned as canonical_id in response).
const RESOURCE_PK: Record<string, string> = {
  customers:           'customer_id',
  sites:               'site_id',
  contacts:            'contact_id',
  jobs:                'job_id',
  assets:              'asset_id',
  asset_test_results:  'result_id',
  asset_defects:       'defect_id',
};

// Fail fast at module load if the three resource maps fall out of sync: every
// writable resource MUST have a RESOURCES entry (table/select) and a RESOURCE_PK,
// or handlePut would dereference `undefined` at runtime instead of 400-ing.
for (const k of Object.keys(WRITABLE_FIELDS)) {
  if (!RESOURCES[k] || !RESOURCE_PK[k]) {
    throw new Error(
      `canonical-api misconfig: writable resource '${k}' missing from ${!RESOURCES[k] ? 'RESOURCES' : 'RESOURCE_PK'}`);
  }
}

interface UpsertBody {
  resource:    string;
  external_id: string;
  [key: string]: unknown;
}

interface UpsertOkBody {
  ok:           true;
  tenant:       string;
  resource:     string;
  canonical_id: string;
  created:      boolean;
}

async function handlePut(
  req: Request,
  caller: AppIdentity,
  tenantSlug: string,
): Promise<Response> {
  // Parse body
  let body: UpsertBody;
  try {
    body = await req.json() as UpsertBody;
  } catch {
    return err(400, 'invalid_filter', 'body must be valid JSON');
  }

  const resourceName = body.resource;
  if (!resourceName || !WRITABLE_FIELDS[resourceName]) {
    return err(400, 'unknown_resource',
      `resource must be one of: ${Object.keys(WRITABLE_FIELDS).join(', ')}`);
  }

  if (!body.external_id || typeof body.external_id !== 'string') {
    return err(400, 'invalid_filter', 'external_id must be a non-empty string');
  }
  if (body.external_id.length > 255) {
    return err(400, 'invalid_filter', 'external_id must be <= 255 chars');
  }

  // Resolve tenant
  const { getRoutingBySlug } = await import('./_shared/tenant-routing.js');
  let routing: Awaited<ReturnType<typeof getRoutingBySlug>>;
  try {
    routing = await getRoutingBySlug(tenantSlug);
  } catch (e) {
    return tenantError(e);
  }

  // Build the upsert row — only allowed fields, tenant_id forced from routing
  const allowed = WRITABLE_FIELDS[resourceName];
  const row: Record<string, unknown> = { tenant_id: routing.tenant_id };
  for (const [k, v] of Object.entries(body)) {
    if (k !== 'resource' && allowed.has(k)) {
      row[k] = v;
    }
  }
  // Always set external_id from the body (already validated)
  row.external_id = body.external_id;

  const def = RESOURCES[resourceName];
  const pk  = RESOURCE_PK[resourceName];

  let client: SupabaseClient<any, any, any>;
  try {
    client = await getTenantDataClient(tenantSlug);
  } catch (e) {
    return tenantError(e);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cAny = client as any;

  // PostgREST's `.upsert()` with onConflict does not support partial unique
  // indexes (the WHERE external_id IS NOT NULL clause on migration 022).
  // Use a select-then-insert-or-update pattern instead — two round-trips but
  // deterministic and compatible with partial indexes.

  // Step 1: look up existing row by (tenant_id, external_id)
  const { data: byExtId, error: selectErr } = await cAny
    .schema('app_data')
    .from(def.table)
    .select(`${pk}, created_at`)
    .eq('tenant_id', routing.tenant_id)
    .eq('external_id', body.external_id)
    .maybeSingle();

  if (selectErr) {
    console.error('[canonical-api] PUT select failed', {
      app: caller.app, tenantSlug, resource: resourceName,
      external_id: body.external_id, error: selectErr.message,
    });
    return err(500, 'internal_error', selectErr.message);
  }

  // Step 1b (customers only): if no external_id match, attempt a deterministic
  // secondary match by email or ABN before creating a new record. Prevents
  // cross-app fragmentation when the same physical customer exists under a
  // different external_id (e.g. Service vs Quotes both create "Acme").
  // Phone is intentionally excluded — too many shared numbers (receptions, mobiles).
  // We return the matched canonical_id so the caller stamps it locally; the
  // existing record's external_id is preserved (no overwrite).
  let secondaryMatch: { customer_id: string } | null = null;
  if (!byExtId && resourceName === 'customers') {
    const email = typeof row.email === 'string' && row.email.trim() ? row.email.trim().toLowerCase() : null;
    const abn   = typeof row.abn   === 'string' && row.abn.trim()   ? row.abn.trim().replace(/\s/g, '')  : null;

    if (email || abn) {
      let q = cAny
        .schema('app_data')
        .from('customers')
        .select('customer_id')
        .eq('tenant_id', routing.tenant_id);

      if (email && abn) {
        q = q.or(`email.eq.${email},abn.eq.${abn}`);
      } else if (email) {
        q = q.eq('email', email);
      } else {
        q = q.eq('abn', abn);
      }

      const { data: matched, error: matchErr } = await q.limit(1).maybeSingle();
      if (matchErr) {
        console.warn('[canonical-api] customer secondary match failed — proceeding to insert', {
          app: caller.app, tenantSlug, error: matchErr.message,
        });
      } else if (matched) {
        secondaryMatch = matched as { customer_id: string };
        console.info('[canonical-api] customer secondary match (email/abn)', {
          app: caller.app, tenantSlug, external_id: body.external_id,
          matched_id: secondaryMatch.customer_id,
        });
      }
    }
  }

  const existing = byExtId ?? secondaryMatch;

  let canonicalId: string;
  let created: boolean;

  if (existing) {
    // Step 2a: UPDATE — merge incoming fields; strip immutable columns.
    // For a secondary match (email/abn), also stamp the caller's external_id
    // so future lookups hit Step 1 directly and skip the secondary scan.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tenant_id: _tid, external_id: _eid, ...mutableFields } = row as Record<string, unknown>;
    const updateRow: Record<string, unknown> = {
      ...mutableFields,
      updated_at: new Date().toISOString(),
      ...(secondaryMatch ? { external_id: body.external_id } : {}),
    };

    const { error: updateErr } = await cAny
      .schema('app_data')
      .from(def.table)
      .update(updateRow)
      .eq('tenant_id', routing.tenant_id)
      .eq(pk, existing[pk]);

    if (updateErr) {
      console.error('[canonical-api] PUT update failed', {
        app: caller.app, tenantSlug, resource: resourceName,
        external_id: body.external_id, error: updateErr.message,
      });
      return err(500, 'internal_error', updateErr.message);
    }

    canonicalId = existing[pk] as string;
    created = false;
  } else {
    // Step 2b: INSERT new row
    const { data: inserted, error: insertErr } = await cAny
      .schema('app_data')
      .from(def.table)
      .insert(row)
      .select(pk)
      .single();

    if (insertErr) {
      // Concurrent create with the same (tenant_id, external_id): the partial
      // unique index rejects the loser with 23505. Re-resolve and UPDATE so the
      // upsert stays idempotent under concurrency rather than 500-ing a create
      // that actually succeeded.
      if ((insertErr as { code?: string }).code === '23505') {
        const { data: raced } = await cAny
          .schema('app_data')
          .from(def.table)
          .select(pk)
          .eq('tenant_id', routing.tenant_id)
          .eq('external_id', body.external_id)
          .maybeSingle();
        if (raced) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { tenant_id: _tid, external_id: _eid, ...mutableFields } = row as Record<string, unknown>;
          const { error: updateErr } = await cAny
            .schema('app_data')
            .from(def.table)
            .update({ ...mutableFields, updated_at: new Date().toISOString() })
            .eq('tenant_id', routing.tenant_id)
            .eq(pk, raced[pk]);
          if (updateErr) return err(500, 'internal_error', updateErr.message);
          canonicalId = raced[pk] as string;
          created = false;
        } else {
          return err(500, 'internal_error', insertErr.message);
        }
      } else {
        console.error('[canonical-api] PUT insert failed', {
          app: caller.app, tenantSlug, resource: resourceName,
          external_id: body.external_id, error: insertErr.message,
        });
        return err(500, 'internal_error', insertErr.message);
      }
    } else {
      canonicalId = inserted[pk] as string;
      created = true;
    }
  }

  const responseBody: UpsertOkBody = {
    ok:           true,
    tenant:       tenantSlug,
    resource:     resourceName,
    canonical_id: canonicalId,
    created,
  };

  return new Response(JSON.stringify(responseBody), {
    status:  created ? 201 : 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ──────────────────────────────────────────────────────────────────────
// POST handler (events only for now)
// ──────────────────────────────────────────────────────────────────────

interface EventInsert {
  resource:  'events';
  event:     string;
  payload?:  Record<string, unknown>;
}

async function handlePost(
  req: Request,
  caller: AppIdentity,
  tenantSlug: string,
): Promise<Response> {
  let body: EventInsert;
  try {
    body = await req.json() as EventInsert;
  } catch {
    return err(400, 'invalid_filter', 'body must be valid JSON');
  }
  if (body.resource !== 'events') {
    return err(400, 'unknown_resource', 'POST only supports resource="events"');
  }
  if (!body.event || typeof body.event !== 'string') {
    return err(400, 'invalid_filter', 'event must be a non-empty string');
  }
  if (body.event.length > 100) {
    return err(400, 'invalid_filter', 'event name must be <= 100 chars');
  }
  const payload = body.payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return err(400, 'invalid_filter', 'payload must be a JSON object');
  }

  let client: SupabaseClient<any, any, any>;
  try {
    client = await getTenantDataClient(tenantSlug);
  } catch (e) {
    return tenantError(e);
  }

  // We need the actual tenant_id (UUID) to insert — the JWT-based default
  // doesn't kick in for service-role requests. Resolve it via the routing
  // helper too (it cached tenant_id when looking up the slug).
  // Cheap second lookup; cache makes it ~0 cost.
  const { getRoutingBySlug } = await import('./_shared/tenant-routing.js');
  const routing = await getRoutingBySlug(tenantSlug);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cAny = client as any;
  const { data, error } = await cAny
    .schema('app_data')
    .from('canonical_events')
    .insert({
      tenant_id:  routing.tenant_id,
      app_source: caller.app,
      event:      body.event,
      payload,
    })
    .select('id, occurred_at')
    .single();

  if (error) {
    console.error('[canonical-api] event insert failed', { app: caller.app, tenantSlug, event: body.event, error: error.message });
    return err(500, 'internal_error', error.message);
  }

  return json(200, {
    ok:       true,
    tenant:   tenantSlug,
    resource: 'events',
    total:    1,
    limit:    1,
    offset:   0,
    data:     [data],
  });
}

// ──────────────────────────────────────────────────────────────────────
// Tenant-routing error → HTTP mapping
// ──────────────────────────────────────────────────────────────────────

function tenantError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return err(404, 'invalid_tenant', e.message);
  }
  if (e instanceof TenantNotActiveError) {
    return err(402, 'tenant_inactive', `status=${e.status}`);
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[canonical-api] tenant routing misconfigured', e);
    return err(500, 'internal_error', 'tenant routing unavailable');
  }
  console.error('[canonical-api] unexpected tenant resolution error', e);
  return err(500, 'internal_error', 'tenant resolution failed');
}

// ──────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url);

  const caller = authenticateCaller(req);
  if (!caller) return err(401, 'auth_failed', 'missing or invalid bearer key');

  const tenantSlug =
    req.headers.get('x-tenant') ?? url.searchParams.get('tenant') ?? '';
  if (!tenantSlug) return err(400, 'missing_tenant', 'X-Tenant header or ?tenant= required');
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(tenantSlug)) {
    return err(400, 'invalid_tenant', 'tenant slug shape rejected');
  }

  // Per-app tenant scope check. A leaked bearer key authenticates the calling
  // app — but it must NOT grant access to arbitrary tenants. Each app gets an
  // explicit allow-list. '*' means cross-tenant (platform tools only).
  // Temporary hardcoded map — replace with a shell_control.app_tenant_scope
  // table lookup when app-tenant registration is built.
  // TODO: replace APP_TENANT_SCOPE with a shell_control.app_tenant_scope table lookup
  const APP_TENANT_SCOPE: Record<AppIdentity['app'], string[]> = {
    cards:   ['*'],
    field:   ['eq', 'sks', 'demo-trades', 'melbourne'],
    service: ['*'],
    quotes:  ['*'],
    shell:   ['*'],
  };
  const scope = APP_TENANT_SCOPE[caller.app] ?? [];
  if (!scope.includes('*') && !scope.includes(tenantSlug)) {
    return err(403, 'forbidden', 'App not authorised for this tenant');
  }

  if (req.method === 'GET')  return handleGet(req, url, caller, tenantSlug);
  if (req.method === 'PUT')  return handlePut(req, caller, tenantSlug);
  if (req.method === 'POST') return handlePost(req, caller, tenantSlug);
  return err(405, 'method_not_allowed');
});
