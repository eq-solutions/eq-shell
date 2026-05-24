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

  if (req.method === 'GET')  return handleGet(req, url, caller, tenantSlug);
  // eslint-disable-line @typescript-eslint/no-unused-vars  (suppress "_req unused" — kept for symmetry + future use)
  if (req.method === 'POST') return handlePost(req, caller, tenantSlug);
  return err(405, 'method_not_allowed');
});
