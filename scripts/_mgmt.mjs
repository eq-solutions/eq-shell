// scripts/_mgmt.mjs
//
// Shared helpers for the tenant tooling (migrate-tenants, check-tenant-drift):
// ONE place for the Supabase Management API call, control-plane ref resolution,
// and the active-tenant lookup — so the two scripts can't drift apart on env
// contract or response handling.

const MGMT = 'https://api.supabase.com/v1';

export function requireAccessToken() {
  const t = process.env.SUPABASE_ACCESS_TOKEN;
  if (!t) {
    console.error('ERROR: missing env var SUPABASE_ACCESS_TOKEN (Supabase Management API token)');
    process.exit(1);
  }
  return t;
}

// Control-plane project ref. Prefers explicit CONTROL_PROJECT_REF; falls back to
// deriving it from the legacy CONTROL_SUPABASE_URL (https://<ref>.supabase.co)
// so existing onboarding/provision environments keep working without a new var.
export function controlRef() {
  const explicit = process.env.CONTROL_PROJECT_REF;
  if (explicit) return explicit;
  const url = process.env.CONTROL_SUPABASE_URL;
  if (url) {
    try { return new URL(url).hostname.split('.')[0]; } catch { /* fall through */ }
  }
  console.error('ERROR: set CONTROL_PROJECT_REF (or CONTROL_SUPABASE_URL to derive it)');
  process.exit(1);
}

// Run SQL via the Management API. Returns the parsed JSON body (a row array for
// SELECTs, [] for DDL). Authenticated by SUPABASE_ACCESS_TOKEN — runs as postgres,
// so it applies DDL without any per-tenant exec_sql function.
export async function mgmtQuery(ref, query) {
  const res = await fetch(`${MGMT}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${requireAccessToken()}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API query failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : [];
}

// Same as mgmtQuery but ASSERTS the body is a row array. Use for SELECTs whose
// rows we consume — a wrapped/unexpected shape fails LOUD here instead of
// silently reading as "no rows" (which would make the runner re-apply
// everything, or the drift gate report a false "no drift").
export async function mgmtRows(ref, query) {
  const body = await mgmtQuery(ref, query);
  if (!Array.isArray(body)) {
    throw new Error(`Management API returned a non-array result for ${ref}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

// Single-quote a string for inline SQL.
export function sqlLiteral(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// Active (+ provisioning, optionally suspended) tenants from the control plane,
// via the Management API: { slug, ref, status }[].
export async function loadActiveTenants({ includeSuspended = false, slug = null } = {}) {
  const ref = controlRef();
  const statuses = includeSuspended
    ? `'provisioning','active','suspended'`
    : `'provisioning','active'`;
  const slugFilter = slug ? `AND t.slug = ${sqlLiteral(slug)}` : '';
  return mgmtRows(ref, `
    SELECT tr.supabase_project_ref AS ref, tr.status AS status, t.slug AS slug
    FROM shell_control.tenant_routing tr
    JOIN shell_control.tenants t ON t.id = tr.tenant_id
    WHERE tr.status IN (${statuses}) ${slugFilter}
    ORDER BY t.slug;
  `);
}

// Bounded-concurrency map — used by the runner so many tenants don't run strictly
// one-at-a-time, while staying under Management API rate limits.
export async function mapWithConcurrency(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return out;
}
