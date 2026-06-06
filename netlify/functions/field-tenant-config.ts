// GET /.netlify/functions/field-tenant-config
//
// F1 (Field unification) — the discovery contract the unified Field app calls
// instead of hardcoding TENANT_SUPABASE.eq/.sks. Returns the caller's tenant
// slug, feature tier, and the resolved feature flags for that tier so Field can
// gate its UI per-tenant.
//
// Resolves the tenant from session.tenant_id ONLY — never a query-param slug.
// This sidesteps the slug trap (tenant_routing names the EQ control tenant
// `core`, but Field's UI calls it `eq`) and makes cross-tenant config-fishing
// impossible: a session can only ever read its own tenant's config.
//
// Gated on the `field` module being enabled for the tenant (403 otherwise),
// mirroring the server-side module check used across the login functions.
//
// DELIBERATELY DOES NOT return Supabase connection details (url / anon key) or
// mint a data-plane JWT. How Field authenticates to its data plane is the open
// α-vs-β decision in docs/field-auth-unification-options.md — this endpoint
// ships the half that's correct under BOTH options (Field needs its tier in
// either case). The auth half lands once that fork is decided.
//
// Response:
//   200 OK { tenant_id, tenant_slug, tier, features }
//   401      { ok: false, error: 'unauthorized' }    // no/bad session cookie
//   403      { ok: false, error: 'field-not-enabled' } // field module off
//   500      { ok: false, error: ... }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

// Field feature tiers (docs/FIELD-UNIFICATION-PLAN.md "End state"). Cumulative:
// each tier inherits everything below it. `tenants.tier` is free text on the
// control plane, so anything unrecognised falls back to the safe `standard`
// floor rather than erroring — a misconfigured tier should under-grant, not
// crash Field on load.
const STANDARD_FEATURES = ['roster', 'timesheets', 'leave'] as const;
const ADVANCED_FEATURES = [...STANDARD_FEATURES, 'projects', 'apprentice'] as const;
const ENTERPRISE_FEATURES = [
  ...ADVANCED_FEATURES,
  'forecast',
  'regions',
  'teams',
  'resource_allocation',
  'pipeline',
  'timesheet_locks',
  'site_reports',
  'diary',
] as const;

const TIER_FEATURES: Record<string, readonly string[]> = {
  standard: STANDARD_FEATURES,
  advanced: ADVANCED_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
};

function featuresForTier(tier: string): readonly string[] {
  return TIER_FEATURES[tier] ?? STANDARD_FEATURES;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { ok: false, error: 'server-misconfigured' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error: (e as Error).message });
  }

  // Tenant resolved from the session, never the request. getServiceClient
  // defaults to the shell_control schema, so these are shell_control.tenants /
  // shell_control.module_entitlements.
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, tier, active')
    .eq('id', session.tenant_id)
    .maybeSingle<{ id: string; slug: string; tier: string | null; active: boolean }>();

  if (tenantErr) {
    return jsonResponse(500, { ok: false, error: 'tenant-read-failed' });
  }
  if (!tenant || !tenant.active) {
    return jsonResponse(403, { ok: false, error: 'tenant-inactive' });
  }

  const { data: fieldEnt, error: entErr } = await sb
    .from('module_entitlements')
    .select('enabled')
    .eq('tenant_id', tenant.id)
    .eq('module', 'field')
    .maybeSingle<{ enabled: boolean }>();

  if (entErr) {
    return jsonResponse(500, { ok: false, error: 'entitlement-read-failed' });
  }
  if (!fieldEnt || !fieldEnt.enabled) {
    return jsonResponse(403, { ok: false, error: 'field-not-enabled' });
  }

  const tier = (tenant.tier ?? 'standard').trim() || 'standard';

  return jsonResponse(200, {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    tier,
    features: featuresForTier(tier),
  });
});
