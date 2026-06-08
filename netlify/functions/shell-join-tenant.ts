// POST /.netlify/functions/shell-join-tenant
//
// Body: { phone: string, access_token: string, tenant_slug: string }
//
// Self-register counterpart to shell-login-phone-otp. A worker arrives
// via a tenant QR code or join code, verifies their phone OTP in EQ Cards,
// then Cards calls this endpoint to:
//
//   1. Validate the Supabase GoTrue token (same 2-attempt retry as phone-otp).
//   2. Confirm phone in GoTrue user matches submitted phone.
//   3. Look up the tenant by slug.
//   4. If the user already exists in shell_control.users (invited user
//      scanning the QR instead of using their link) — return their
//      existing JWT immediately (same path as phone-otp success).
//   5. Otherwise provision: create shell_control.users, public.profiles,
//      and public.org_memberships rows (all idempotent via ON CONFLICT DO NOTHING).
//   6. Mint a shell JWT and session cookie, return { valid: true, is_new_user: true }.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalTenant } from './_shared/supabase.js';
import { signSessionToken, hasSecretSalt, DEFAULT_TENANT_CONFIG } from './_shared/token.js';
import { signSupabaseJwt, hasSupabaseJwtSecret } from './_shared/supabase-jwt.js';
import { buildSessionCookie } from './_shared/cookie.js';
import { withSentry } from './_shared/sentry.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SUPABASE_JWT_TTL_SECONDS = 15 * 60;

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
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
  if (process.env.ENABLE_PHONE_OTP !== 'true') {
    return new Response(JSON.stringify({ error: 'Not available' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }
  if (!hasSupabaseJwtSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing SUPABASE_JWT_SECRET' });
  }

  let body: { phone?: string; access_token?: string; tenant_slug?: string };
  try {
    body = (await req.json()) as { phone?: string; access_token?: string; tenant_slug?: string };
  } catch {
    return jsonResponse(400, { valid: false });
  }

  const phone = normalizeAuPhone((body.phone ?? '').trim());
  const accessToken = (body.access_token ?? '').trim();
  const tenantSlug = (body.tenant_slug ?? '').trim();
  if (!phone || !accessToken || !tenantSlug) {
    return jsonResponse(400, { valid: false });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Validate the Supabase access_token. Retry once on transient failure —
  // GoTrue occasionally returns 403 immediately after phone OTP verification
  // (observed 2026-06-06T21:32Z — the session wasn't fully committed when the
  // Lambda called /user ~1s after verifyOtp). A 500ms pause resolves it.
  let authUser: { phone?: string | null; id?: string } | null = null;
  let authErr: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    const result = await sb.auth.getUser(accessToken);
    authErr = result.error;
    authUser = result.data?.user ?? null;
    if (!authErr && authUser) break;
  }
  if (authErr || !authUser) {
    return jsonResponse(200, { valid: false });
  }

  const supabasePhone = normalizeAuPhone(authUser.phone ?? '');
  if (!supabasePhone || supabasePhone !== phone) {
    return jsonResponse(200, { valid: false });
  }

  // Look up tenant by slug.
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, slug, name, brand_color, brand_logo_url, active')
    .eq('slug', tenantSlug)
    .eq('active', true)
    .maybeSingle<CanonicalTenant>();

  if (tenantErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-join-tenant] tenants lookup error:', tenantErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }
  if (!tenant) {
    return jsonResponse(200, { valid: false });
  }

  // Check if the user already has an account in shell_control.users.
  type UserRow = {
    id: string;
    email: string | null;
    name: string | null;
    tenant_id: string;
    role: string;
    is_platform_admin: boolean;
    active: boolean;
    last_login_at: string | null;
    totp_secret: string | null;
    totp_enrolled_at: string | null;
    created_at: string | null;
  };

  const { data: existingUser, error: existingUserErr } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active, last_login_at, totp_secret, totp_enrolled_at, created_at')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle<UserRow>();

  if (existingUserErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-join-tenant] existing users lookup error:', existingUserErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('client-ip') ??
    'unknown';

  if (existingUser) {
    // User already has an account — return their existing JWT (same as phone-otp success path).
    // This handles the case where an invited user scans the QR instead of using their link.
    void sb.schema('public').rpc('eq_write_audit_log', {
      p_event: 'login.join_register',
      p_actor_id: existingUser.id,
      p_tenant_id: tenant.id,
      p_ip: ip,
      p_detail: { method: 'join-tenant', is_new_user: false, tenant_slug: tenantSlug },
    });

    const exp = Date.now() + SESSION_TTL_MS;
    const cookieValue = signSessionToken({
      user_id: existingUser.id,
      tenant_id: existingUser.tenant_id,
      active_tenant_id: existingUser.tenant_id,
      role: existingUser.role as any,
      is_platform_admin: existingUser.is_platform_admin,
      memberships: [{ tenant_id: existingUser.tenant_id, role: existingUser.role as any }],
      config: DEFAULT_TENANT_CONFIG,
      exp,
    });
    const cookie = buildSessionCookie(req, cookieValue, {
      maxAgeSeconds: SESSION_TTL_MS / 1000,
    });

    const { token: supabaseJwt } = signSupabaseJwt(
      existingUser.id,
      existingUser.tenant_id,
      existingUser.role as any,
      existingUser.is_platform_admin,
      SUPABASE_JWT_TTL_SECONDS,
      'cards',
      undefined,
      tenant.slug,
    );

    // Look up tenant info for the existing user's tenant (may differ from the slug-resolved tenant).
    const { data: existingTenant } = await sb
      .from('tenants')
      .select('id, slug, name, brand_color, brand_logo_url, active')
      .eq('id', existingUser.tenant_id)
      .maybeSingle<CanonicalTenant>();

    return jsonResponse(
      200,
      {
        valid: true,
        supabase_jwt: supabaseJwt,
        tenant: existingTenant ?? tenant,
        is_new_user: false,
      },
      { 'Set-Cookie': cookie },
    );
  }

  // New user — provision account.

  // Step 7: look up org for this tenant.
  const { data: org } = await sb
    .schema('public')
    .from('organisations')
    .select('id, name, tenant_id')
    .eq('tenant_id', tenant.id)
    .maybeSingle<{ id: string; name: string; tenant_id: string }>();

  // Step 8: create shell_control.users row.
  // upsert with ignoreDuplicates=true is equivalent to INSERT ... ON CONFLICT (id) DO NOTHING —
  // idempotent if a row snuck in between our check and this insert (race condition).
  const { error: insertUserErr } = await sb
    .from('users')
    .upsert(
      {
        id: authUser.id,
        phone,
        tenant_id: tenant.id,
        role: 'employee',
        is_platform_admin: false,
        active: true,
        name: '',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

  if (insertUserErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-join-tenant] insert users error:', insertUserErr.message);
    return jsonResponse(500, { error: 'Database error' });
  }

  // Step 9: create public.profiles row.
  const { error: insertProfileErr } = await sb
    .schema('public')
    .from('profiles')
    .upsert(
      { id: authUser.id, mobile: phone },
      { onConflict: 'id', ignoreDuplicates: true },
    );

  if (insertProfileErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-join-tenant] insert profiles error:', insertProfileErr.message);
    // Non-fatal: the user row was created; continue and the profile can be filled later.
  }

  // Step 10: create org_memberships row if we found an org.
  if (org) {
    const { error: insertMemberErr } = await sb
      .schema('public')
      .from('org_memberships')
      .upsert(
        {
          org_id: org.id,
          user_id: authUser.id,
          role: 'employee',
          status: 'active',
          accepted_at: new Date().toISOString(),
          tenant_id: tenant.id,
        },
        { onConflict: 'org_id,user_id', ignoreDuplicates: true },
      );

    if (insertMemberErr) {
      // eslint-disable-next-line no-console
      console.error('[shell-join-tenant] insert org_memberships error:', insertMemberErr.message);
      // Non-fatal: user is provisioned; membership can be repaired via admin tools.
    }
  }

  // Step 11: audit log.
  void sb.schema('public').rpc('eq_write_audit_log', {
    p_event: 'login.join_register',
    p_actor_id: authUser.id,
    p_tenant_id: tenant.id,
    p_ip: ip,
    p_detail: { method: 'join-tenant', is_new_user: true, tenant_slug: tenantSlug },
  });

  // Step 12: mint JWT.
  const { token: supabaseJwt } = signSupabaseJwt(
    authUser.id!,
    tenant.id,
    'employee',
    false,
    SUPABASE_JWT_TTL_SECONDS,
    'cards',
    undefined,
    tenant.slug,
  );

  // Step 13: build session cookie.
  const exp = Date.now() + SESSION_TTL_MS;
  const cookieValue = signSessionToken({
    user_id: authUser.id!,
    tenant_id: tenant.id,
    active_tenant_id: tenant.id,
    role: 'employee',
    is_platform_admin: false,
    memberships: [{ tenant_id: tenant.id, role: 'employee' }],
    config: DEFAULT_TENANT_CONFIG,
    exp,
  });
  const cookie = buildSessionCookie(req, cookieValue, {
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });

  // Step 14: return success.
  return jsonResponse(
    200,
    {
      valid: true,
      supabase_jwt: supabaseJwt,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        brand_color: tenant.brand_color,
        brand_logo_url: tenant.brand_logo_url,
      },
      is_new_user: true,
    },
    { 'Set-Cookie': cookie },
  );
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
