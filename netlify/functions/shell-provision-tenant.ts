// POST /.netlify/functions/shell-provision-tenant
//
// Body: { phone: string, access_token: string, provision_token: string }
//
// Called by EQ Cards after a new org admin verifies their phone OTP via the
// /provision?token=<uuid> flow. The provision_token is a one-time UUID from
// shell_control.provision_tokens (created by platform admins via
// shell-create-provision-token). On success:
//
//   1. Validate the Supabase GoTrue access_token (2-attempt retry).
//   2. Confirm phone in GoTrue user matches submitted phone.
//   3. Validate provision_token is unused.
//   4. Generate a URL-safe slug from the org name (collision-resolved).
//   5. Atomically consume the provision_token (UPDATE WHERE used_at IS NULL).
//   6. Create shell_control.tenants + module_entitlements + tenant_config.
//   7. Seed default security groups.
//   8. Create shell_control.users (role: manager) + user_tenant_memberships.
//   9. Create public.profiles + public.organisations + public.org_memberships.
//  10. Return { valid: true, tenant_slug }.
//
// No session cookie is minted here — the admin logs into Shell directly
// after provisioning using their phone number, which is now in
// shell_control.users with role 'manager'.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { hasSecretSalt } from './_shared/token.js';
import { hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { seedDefaultGroups } from './_shared/seed-default-groups.js';
import { withSentry } from './_shared/sentry.js';

const DEFAULT_MODULES = ['cards', 'field', 'service', 'intake', 'quotes'] as const;
const DEFAULT_ENABLED = new Set(['cards', 'field', 'service']);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normalizeAuPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+61') && digits.length === 11) return raw;
  if (digits.startsWith('61') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('4')) return '+61' + digits;
  return null;
}

/**
 * Generate a URL-safe slug from an org name.
 * e.g. "SKS Technologies Pty Ltd" → "sks-technologies-pty-ltd"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const ALLOWED_ORIGIN_EXACT = new Set<string>(['https://cards.eq.solutions']);
const ALLOWED_ORIGIN_RE = /^https:\/\/deploy-preview-\d+--eq-cards\.netlify\.app$/;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  if (!ALLOWED_ORIGIN_EXACT.has(origin) && !ALLOWED_ORIGIN_RE.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

async function core(req: Request, _ctx: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  let body: { phone?: string; access_token?: string; provision_token?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { valid: false, error: 'Invalid JSON' });
  }

  const phone = normalizeAuPhone((body.phone ?? '').trim());
  const accessToken = (body.access_token ?? '').trim();
  const provisionTokenId = (body.provision_token ?? '').trim();

  if (!phone || !accessToken || !provisionTokenId) {
    return jsonResponse(400, { valid: false, error: 'phone, access_token, and provision_token are required' });
  }

  // Basic UUID format check — prevents SQL injection via .eq()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(provisionTokenId)) {
    return jsonResponse(400, { valid: false, error: 'Invalid provision token format' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // ── Step 1: Validate GoTrue access_token (2-attempt retry) ──────────────────
  let authUser: { phone?: string | null; id?: string } | null = null;
  let authErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 500));
    const result = await sb.auth.getUser(accessToken);
    authErr = result.error;
    authUser = result.data?.user ?? null;
    if (!authErr && authUser) break;
  }
  if (authErr || !authUser) {
    return jsonResponse(200, { valid: false, error: 'Token validation failed' });
  }

  // ── Step 2: Confirm phone matches GoTrue user ───────────────────────────────
  const supabasePhone = normalizeAuPhone(authUser.phone ?? '');
  if (!supabasePhone || supabasePhone !== phone) {
    return jsonResponse(200, { valid: false, error: 'Phone mismatch' });
  }

  // ── Step 3: Validate provision token ────────────────────────────────────────
  type TokenRow = { id: string; org_name: string; used_at: string | null };
  const { data: tokenRow, error: tokenErr } = await sb
    .schema('shell_control')
    .from('provision_tokens')
    .select('id, org_name, used_at')
    .eq('id', provisionTokenId)
    .maybeSingle<TokenRow>();

  if (tokenErr) {
    console.error('[shell-provision-tenant] provision_tokens lookup error:', tokenErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!tokenRow) {
    return jsonResponse(400, { valid: false, error: 'Invalid or expired invitation link' });
  }
  if (tokenRow.used_at) {
    return jsonResponse(409, { valid: false, error: 'This invitation link has already been used' });
  }

  const orgName = tokenRow.org_name.trim();
  if (!orgName) {
    return jsonResponse(400, { valid: false, error: 'Organisation name is missing from the invitation' });
  }

  // ── Step 4: Generate slug with collision resolution ──────────────────────────
  const baseSlug = slugify(orgName);
  if (!baseSlug) {
    return jsonResponse(400, { valid: false, error: 'Could not generate a valid slug from the organisation name' });
  }

  let finalSlug = baseSlug;
  for (let i = 1; i <= 10; i++) {
    const candidate = i === 1 ? baseSlug : `${baseSlug}-${i}`;
    const { data: existing } = await sb
      .from('tenants')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle<{ id: string }>();
    if (!existing) {
      finalSlug = candidate;
      break;
    }
    if (i === 10) {
      console.error('[shell-provision-tenant] slug exhausted for base:', baseSlug);
      return jsonResponse(409, { valid: false, error: 'Could not generate a unique workspace slug — please contact support' });
    }
  }

  // ── Step 5: Atomically consume the provision token ───────────────────────────
  // UPDATE WHERE used_at IS NULL — if two requests race, only one wins.
  const { data: consumed } = await sb
    .schema('shell_control')
    .from('provision_tokens')
    .update({ used_at: new Date().toISOString(), used_by_phone: phone })
    .eq('id', provisionTokenId)
    .is('used_at', null)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (!consumed) {
    // Another request consumed it in the race window
    return jsonResponse(409, { valid: false, error: 'This invitation link has already been used' });
  }

  // ── Step 6: Create shell_control.tenants ─────────────────────────────────────
  const { data: newTenant, error: tenantErr } = await sb
    .from('tenants')
    .insert({ slug: finalSlug, name: orgName, active: true, tier: 'standard' })
    .select('id')
    .single<{ id: string }>();

  if (tenantErr || !newTenant) {
    console.error('[shell-provision-tenant] tenants insert error:', tenantErr?.message);
    return jsonResponse(500, { error: 'Failed to create workspace' });
  }
  const tenantId = newTenant.id;

  // ── Step 7: Module entitlements ──────────────────────────────────────────────
  const entitlementRows = DEFAULT_MODULES.map((module) => ({
    tenant_id: tenantId,
    module,
    enabled: DEFAULT_ENABLED.has(module),
  }));
  const { error: entErr } = await sb.from('module_entitlements').insert(entitlementRows);
  if (entErr) {
    console.error('[shell-provision-tenant] module_entitlements insert error:', entErr.message);
    // Best-effort rollback
    await sb.from('tenants').delete().eq('id', tenantId);
    return jsonResponse(500, { error: 'Failed to configure workspace modules' });
  }

  // ── Step 8: Tenant config ────────────────────────────────────────────────────
  await sb.from('tenant_config').insert({
    tenant_id: tenantId,
    feature_flags: {},
    field_settings: { timezone: 'Australia/Sydney', currency: 'AUD', week_start: 'monday' },
  }).then(({ error }) => {
    if (error) console.warn('[shell-provision-tenant] tenant_config insert failed (non-fatal):', error.message);
  });

  // ── Step 9: Seed default security groups ─────────────────────────────────────
  try {
    await seedDefaultGroups(sb, tenantId);
  } catch (e) {
    console.warn('[shell-provision-tenant] default group seed failed (non-fatal):', (e as Error).message);
  }

  // ── Step 10: Create shell_control.users ──────────────────────────────────────
  const { error: userErr } = await sb
    .from('users')
    .upsert(
      {
        id: authUser.id,
        phone,
        tenant_id: tenantId,
        role: 'manager',
        is_platform_admin: false,
        active: true,
        name: '',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

  if (userErr) {
    console.error('[shell-provision-tenant] users insert error:', userErr.message);
    return jsonResponse(500, { error: 'Failed to create user account' });
  }

  // ── Step 11: User tenant membership ──────────────────────────────────────────
  const { error: utmErr } = await sb
    .schema('shell_control')
    .from('user_tenant_memberships')
    .upsert(
      { user_id: authUser.id!, tenant_id: tenantId, role: 'manager' as const, active: true },
      { onConflict: 'user_id,tenant_id', ignoreDuplicates: true },
    );

  if (utmErr) {
    console.error('[shell-provision-tenant] user_tenant_memberships insert error:', utmErr.message);
    return jsonResponse(500, { error: 'Failed to configure user membership' });
  }

  // ── Step 12: Public profile ───────────────────────────────────────────────────
  await sb
    .schema('public')
    .from('profiles')
    .upsert({ id: authUser.id, mobile: phone }, { onConflict: 'id', ignoreDuplicates: true })
    .then(({ error }) => {
      if (error) console.warn('[shell-provision-tenant] profiles insert failed (non-fatal):', error.message);
    });

  // ── Step 13: Public organisation ─────────────────────────────────────────────
  const { data: newOrg, error: orgErr } = await sb
    .schema('public')
    .from('organisations')
    .insert({ name: orgName, slug: finalSlug, tenant_id: tenantId })
    .select('id')
    .maybeSingle<{ id: string }>();

  if (orgErr) {
    console.warn('[shell-provision-tenant] organisations insert failed (non-fatal):', orgErr.message);
  }

  // ── Step 14: Org membership ───────────────────────────────────────────────────
  if (newOrg) {
    await sb
      .schema('public')
      .from('org_memberships')
      .upsert(
        {
          org_id: newOrg.id,
          user_id: authUser.id,
          role: 'admin',
          status: 'active',
          accepted_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,user_id', ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (error) console.warn('[shell-provision-tenant] org_memberships insert failed (non-fatal):', error.message);
      });
  }

  // ── Step 15: Audit log ────────────────────────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('client-ip') ??
    'unknown';

  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'tenant.self_provisioned',
    p_actor_id: authUser.id,
    p_tenant_id: tenantId,
    p_ip: ip,
    p_detail: { org_name: orgName, slug: finalSlug, method: 'provision-token' },
  });

  // Return the GoTrue access_token so Cards can deep-link the admin
  // straight into their new workspace via #sh= (shell-handoff-provision).
  return jsonResponse(200, { valid: true, tenant_slug: finalSlug, access_token: accessToken });
}

export default withSentry(async (req: Request, ctx: Context): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  const res = await core(req, ctx);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
