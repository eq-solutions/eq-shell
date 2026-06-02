// GET  /.netlify/functions/admin-tenants          — list all tenants
// POST /.netlify/functions/admin-tenants          — create tenant identity layer
//
// Platform-admin only. Service-role queries against shell_control that can't
// be done from the browser directly.
//
// GET response:
//   { tenants: Array<TenantWithRouting> }
//
// POST body:  { slug, name, brand_color?, modules: string[] }
// POST effect: inserts into tenants, module_entitlements, tenant_config.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const ALLOWED_MODULES = ['cards', 'field', 'service', 'intake', 'quotes'] as const;

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  // Platform admin only
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (!session.is_platform_admin) return jsonResponse(403, { error: 'Platform admin only' });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // ── GET: list all tenants with routing status ─────────────────────────────
  if (req.method === 'GET') {
    // Left join: some tenants have no routing row — supabase-js returns null
    // for the nested object when there's no match.
    const { data, error } = await sb
      .from('tenants')
      .select(`
        id, slug, name, brand_color, tier, active, created_at,
        tenant_routing ( status, supabase_url, last_error, last_error_at )
      `)
      .order('created_at', { ascending: true });

    if (error) return jsonResponse(500, { error: error.message });

    const tenants = (data ?? []).map((row: any) => ({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      brand_color: row.brand_color as string | null,
      tier: row.tier as string,
      active: row.active as boolean,
      created_at: row.created_at as string,
      routing: row.tenant_routing
        ? {
            status: (row.tenant_routing as any).status as string,
            supabase_url: (row.tenant_routing as any).supabase_url as string | null,
            last_error: (row.tenant_routing as any).last_error as string | null,
            last_error_at: (row.tenant_routing as any).last_error_at as string | null,
          }
        : null,
    }));

    return jsonResponse(200, { tenants });
  }

  // ── POST: create tenant identity layer ────────────────────────────────────
  if (req.method === 'POST') {
    let body: { slug?: string; name?: string; brand_color?: string; modules?: string[]; tier?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    const slug = (body.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const name = (body.name ?? '').trim();
    if (!slug || !name) return jsonResponse(400, { error: 'slug and name required' });
    if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      return jsonResponse(400, { error: 'slug must be lowercase alphanumeric + hyphens, 3-64 chars' });
    }

    const selectedModules = (body.modules ?? []).filter(
      (m): m is (typeof ALLOWED_MODULES)[number] => (ALLOWED_MODULES as readonly string[]).includes(m),
    );

    const tier = (['trial', 'standard', 'advanced', 'enterprise'] as const).includes(body.tier as any)
      ? (body.tier as 'trial' | 'standard' | 'advanced' | 'enterprise')
      : 'standard';

    // Check slug uniqueness
    const { data: existing } = await sb.from('tenants').select('id').eq('slug', slug).maybeSingle<{ id: string }>();
    if (existing) return jsonResponse(409, { error: `Slug "${slug}" is already taken` });

    // Insert tenant
    const { data: newTenant, error: tenantErr } = await sb
      .from('tenants')
      .insert({
        slug,
        name,
        brand_color: body.brand_color ?? null,
        tier,
        active: true,
      })
      .select('id')
      .single<{ id: string }>();

    if (tenantErr || !newTenant) {
      return jsonResponse(500, { error: tenantErr?.message ?? 'Failed to create tenant' });
    }

    const tenantId = newTenant.id;

    // Insert module_entitlements — all known modules, enabled = selected
    const allModules = [...ALLOWED_MODULES];
    const entitlementRows = allModules.map((module) => ({
      tenant_id: tenantId,
      module,
      enabled: selectedModules.includes(module as any),
    }));

    const { error: entErr } = await sb.from('module_entitlements').insert(entitlementRows);
    if (entErr) {
      // Best-effort rollback (delete tenant) then return error
      await sb.from('tenants').delete().eq('id', tenantId);
      return jsonResponse(500, { error: `Failed to create entitlements: ${entErr.message}` });
    }

    // Insert tenant_config with defaults
    const { error: configErr } = await sb.from('tenant_config').insert({
      tenant_id: tenantId,
      feature_flags: {},
      field_settings: { timezone: 'Australia/Sydney', currency: 'AUD', week_start: 'monday' },
    });
    if (configErr) {
      // Non-fatal — defaults are applied at session-mint time anyway
      console.warn('[admin-tenants] tenant_config insert failed:', configErr.message);
    }

    return jsonResponse(201, { id: tenantId, slug, name });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
});
