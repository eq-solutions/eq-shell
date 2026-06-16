// /.netlify/functions/cards-api
//
// The Cards Flutter app's read/write surface against the per-tenant data
// plane. Replaces direct `supabase.rpc('eq_cards_*', ...)` calls against
// shared eq-canonical with HTTPS calls against this function, which
// routes to the tenant DB.
//
// Auth: Supabase JWT (Authorization: Bearer <jwt>). Same JWT Cards mobile
// already mints via /.netlify/functions/mint-supabase-jwt. tenant_id and
// user_id come from app_metadata; both pass through to the tenant-DB
// RPCs explicitly (service-role has no JWT context).
//
// Exception: `lookup_invite_by_phone` is an ANON onboarding op — it runs
// before the worker has a session, so it requires NO JWT and is handled
// before the auth gate. It carries its own per-attacker (IP) rate limit.
//
// Endpoints (multiplexed via ?op=… query param to keep one function):
//
//   GET    /cards-api?op=current_staff
//          → eq_cards_current_staff(tenant_id, user_id)
//          → 200 { staff: <row> | null }
//
//   GET    /cards-api?op=list_my_licences
//          → eq_cards_list_my_licences(tenant_id, user_id)
//          → 200 { licences: [<row>] }
//
//   POST   /cards-api?op=upsert_my_licence   body: { payload }
//          → eq_cards_upsert_my_licence(tenant_id, user_id, payload)
//          → 200 { licence: <row> }
//
//   POST   /cards-api?op=soft_delete_my_licence   body: { licence_id }
//          → eq_cards_soft_delete_my_licence(tenant_id, user_id, licence_id)
//          → 200 { ok: true }
//
//   POST   /cards-api?op=lookup_invite_by_phone   body: { phone, slug }
//          ANON — no JWT (called during onboarding, before the worker has a
//          session). Per-attacker (IP) rate limit is enforced here; the
//          complementary per-slug limit lives in the DB function (migration
//          0034). Both run against eq-canonical via service role.
//          → eq_cards_lookup_invite_by_phone(phone, slug)
//          → 200 { token: <uuid> | null }   429 rate_limited (retry_after_seconds)
//
// Errors return { ok: false, error: '<code>', detail?: '<human>' } with
// HTTP status: 401 not_signed_in, 400 invalid_body / unknown_op /
// invalid_payload, 404 not_found, 500 tenant_rpc_failed / internal_error,
// 503 tenant_inactive.

import type { Context } from '@netlify/functions';
import {
  getTenantRpcClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySupabaseJwt, readBearerJwt } from './_shared/supabase-jwt.js';
import { getServiceClient } from './_shared/supabase.js';
import { withSentry, captureGatewayBlock } from './_shared/sentry.js';

type Op =
  | 'current_staff'
  | 'list_my_licences'
  | 'upsert_my_licence'
  | 'soft_delete_my_licence'
  | 'upsert_my_profile'
  // Control-plane ops — hit eq-canonical via service role, no tenant routing.
  | 'list_licence_types'
  | 'has_pin'
  | 'set_pin'
  | 'verify_pin'
  // Anon onboarding op — no JWT; handled before the auth gate below.
  | 'lookup_invite_by_phone';

const READ_OPS:  ReadonlySet<Op> = new Set<Op>(['current_staff', 'list_my_licences', 'list_licence_types', 'has_pin']);
const WRITE_OPS: ReadonlySet<Op> = new Set<Op>(['upsert_my_licence', 'soft_delete_my_licence', 'upsert_my_profile', 'set_pin', 'verify_pin']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OkBody { ok: true; [k: string]: unknown }
interface ErrBody { ok: false; error: string; detail?: string; retry_after_seconds?: number | null }

// Cards Flutter web lives at cards.eq.solutions and calls this function
// on core.eq.solutions — cross-origin. Native iOS/Android builds don't
// send an Origin header so CORS is a no-op for them; this only matters
// for the web build, but the web build is how Royce smoke-tests.
//
// S2-16: In production, restrict to the two canonical EQ origins only.
// In non-production contexts (deploy-preview, branch-deploy, dev), the
// broader allowlist (including Netlify deploy-preview URLs) is kept so
// that PR previews and staging remain testable.
const isProd = process.env.CONTEXT === 'production';
const PROD_ORIGINS = ['https://core.eq.solutions', 'https://cards.eq.solutions'];
const ALLOWED_ORIGIN_EXACT = new Set<string>(
  isProd ? PROD_ORIGINS : ['https://cards.eq.solutions'],
);
const ALLOWED_ORIGIN_RE    = /^https:\/\/deploy-preview-\d+--eq-cards\.netlify\.app$/;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  // In production, only exact-match against PROD_ORIGINS. The deploy-preview
  // regex is intentionally skipped in production — previews don't run on prod.
  const ok = isProd
    ? ALLOWED_ORIGIN_EXACT.has(origin)
    : (ALLOWED_ORIGIN_EXACT.has(origin) || ALLOWED_ORIGIN_RE.test(origin));
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age':       '600',
    'Vary':                         'Origin',
  };
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const origin = req.headers.get('origin');
  const cors   = corsHeaders(origin);

  // Preflight — browsers send OPTIONS before the real request when the
  // request includes Authorization. Reply 204 with the allow headers.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (status: number, body: OkBody | ErrBody): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });

  const url = new URL(req.url);
  const op  = url.searchParams.get('op') as Op | null;

  // ─── anon onboarding op (no JWT) ───────────────────────────────────
  // lookup_invite_by_phone runs before the worker has a session, so it must
  // NOT require a JWT (unlike every control-plane / tenant op below). The DB
  // function eq_cards_lookup_invite_by_phone can't see the client IP, so its
  // throttle (migration 0034) is per-slug only; this adds the complementary
  // per-attacker (IP) layer before delegating to the DB. Both run against
  // eq-canonical via the service client. Handled here, before the auth gate,
  // so it returns without ever hitting verifySupabaseJwt.
  if (op === 'lookup_invite_by_phone') {
    if (req.method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed', detail: 'lookup_invite_by_phone requires POST' });
    }

    let body: { phone?: string; slug?: string };
    try { body = (await req.json()) as { phone?: string; slug?: string }; }
    catch { return json(400, { ok: false, error: 'invalid_body' }); }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const slug  = typeof body.slug  === 'string' ? body.slug.trim()  : '';
    // Bound the inputs — the DB normalises the phone and lowercases the slug,
    // but cap length here so a hostile caller can't push absurd strings into
    // the rate-limit key or the RPC.
    if (!phone || phone.length > 32 || !slug || slug.length > 128) {
      return json(400, { ok: false, error: 'invalid_lookup', detail: 'phone and slug are required' });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = getServiceClient() as any;

    // Per-attacker (IP) throttle: 30 lookups / 10 min / IP, 10 min lockout.
    // Fail-open when no IP is available (the per-slug DB throttle still
    // applies) — Netlify sets x-nf-client-connection-ip on every real request,
    // so this only skips for malformed/internal calls.
    const ip = clientIp(req);
    if (ip) {
      const { data: rl, error: rlErr } = await ctrl
        .schema('public')
        .rpc('check_and_increment_rate_limit', {
          p_key:          'invite_lookup_ip:' + ip,
          p_window_secs:  600,
          p_max_attempts: 30,
          p_lockout_secs: 600,
        });
      if (rlErr) {
        console.error('[cards-api] invite-lookup IP rate-limit check failed', { error: rlErr.message });
        return json(500, { ok: false, error: 'rate_limit_failed', detail: rlErr.message });
      }
      if (rl?.blocked === true) {
        const retryAfter = Number(rl.retry_after_seconds);
        captureGatewayBlock('ip_throttle', {
          ip,
          slug,
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
        });
        return json(429, {
          ok: false,
          error: 'rate_limited',
          detail: 'Too many invite lookups from this device. Try again later.',
          retry_after_seconds: Number.isFinite(retryAfter) ? retryAfter : null,
        });
      }
    } else {
      console.warn('[cards-api] invite-lookup: no client IP available, skipping per-IP throttle');
    }

    try {
      const { data, error } = await ctrl
        .schema('public')
        .rpc('eq_cards_lookup_invite_by_phone', { p_phone: phone, p_slug: slug });
      if (error) {
        // The per-slug DB guard (migration 0034) raises with hint='rate_limited'
        // and detail=<seconds remaining>. Surface as 429 + retry_after, mirroring
        // the verify_pin lockout mapping above.
        const pgErr = error as { hint?: string; details?: string; message?: string };
        if (pgErr.hint === 'rate_limited') {
          const retryAfter = Number.parseInt(pgErr.details ?? '', 10);
          captureGatewayBlock('slug_throttle', {
            ip,
            slug,
            retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
          });
          return json(429, {
            ok: false,
            error: 'rate_limited',
            detail: error.message,
            retry_after_seconds: Number.isFinite(retryAfter) ? retryAfter : null,
          });
        }
        console.error('[cards-api] invite-lookup rpc failed', { error: error.message });
        return json(500, { ok: false, error: 'lookup_failed', detail: error.message });
      }
      // The RPC returns the invite token (uuid) or null when none matches.
      const token = typeof data === 'string' ? data : null;
      return json(200, { ok: true, token });
    } catch (e) {
      console.error('[cards-api] invite-lookup failed', { error: (e as Error).message });
      return json(500, { ok: false, error: 'internal_error', detail: (e as Error).message });
    }
  }

  // ─── auth ──────────────────────────────────────────────────────────
  const jwt = verifySupabaseJwt(readBearerJwt(req));
  if (!jwt) return json(401, { ok: false, error: 'not_signed_in' });
  const tenantId = jwt.app_metadata.tenant_id;
  const userId   = jwt.sub;
  if (!tenantId || !userId) return json(401, { ok: false, error: 'jwt_missing_tenant_or_user' });

  // ─── op validation + method enforcement ────────────────────────────
  if (!op || (!READ_OPS.has(op) && !WRITE_OPS.has(op))) {
    return json(400, { ok: false, error: 'unknown_op', detail: 'op must be one of: current_staff, list_my_licences, upsert_my_licence, soft_delete_my_licence, upsert_my_profile, list_licence_types, has_pin, set_pin, verify_pin' });
  }
  const isWrite = WRITE_OPS.has(op);
  if (isWrite && req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed', detail: 'write ops require POST' });
  if (!isWrite && req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // ─── control-plane ops (eq-canonical, no tenant routing) ───────────
  const controlOps = new Set<Op>(['list_licence_types', 'has_pin', 'set_pin', 'verify_pin']);
  if (controlOps.has(op)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = getServiceClient() as any;
    try {
      switch (op) {
        case 'list_licence_types': {
          const { data, error } = await ctrl
            .schema('public')
            .from('licence_types')
            .select('*')
            .order('label');
          if (error) return json(500, { ok: false, error: 'licence_types_failed', detail: error.message });
          return json(200, { ok: true, licence_types: data ?? [] });
        }
        case 'has_pin': {
          const { data, error } = await ctrl
            .rpc('has_pin_for_user', { p_user_id: userId });
          if (error) return json(500, { ok: false, error: 'pin_rpc_failed', detail: error.message });
          return json(200, { ok: true, has_pin: data === true });
        }
        case 'set_pin': {
          let body: { pin?: string };
          try { body = (await req.json()) as { pin?: string }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
          if (!body.pin || !/^\d{4}$/.test(body.pin)) {
            return json(400, { ok: false, error: 'invalid_pin', detail: 'pin must be exactly 4 digits' });
          }
          const { error } = await ctrl
            .rpc('set_pin_for_user', { p_user_id: userId, p_pin: body.pin });
          if (error) return json(500, { ok: false, error: 'pin_rpc_failed', detail: error.message });
          return json(200, { ok: true });
        }
        case 'verify_pin': {
          let body: { pin?: string };
          try { body = (await req.json()) as { pin?: string }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
          if (!body.pin || !/^\d{4}$/.test(body.pin)) {
            return json(400, { ok: false, error: 'invalid_pin', detail: 'pin must be exactly 4 digits' });
          }
          const { data, error } = await ctrl
            .rpc('verify_pin_for_user', { p_user_id: userId, p_pin: body.pin });
          if (error) {
            // Brute-force lockout (migration 0032): verify_pin_for_user raises
            // with hint='pin_locked' and detail=<seconds remaining>. Surface it
            // as 429 + retry_after rather than a generic 500.
            const pgErr = error as { hint?: string; details?: string; message?: string };
            if (pgErr.hint === 'pin_locked') {
              const retryAfter = Number.parseInt(pgErr.details ?? '', 10);
              return json(429, {
                ok: false,
                error: 'pin_locked',
                detail: error.message,
                retry_after_seconds: Number.isFinite(retryAfter) ? retryAfter : null,
              });
            }
            return json(500, { ok: false, error: 'pin_rpc_failed', detail: error.message });
          }
          return json(200, { ok: true, verified: data === true });
        }
      }
    } catch (e) {
      console.error('[cards-api] control-plane op failed', { op, error: (e as Error).message });
      return json(500, { ok: false, error: 'internal_error', detail: (e as Error).message });
    }
  }

  // ─── open tenant DB ────────────────────────────────────────────────
  let tenantDb;
  try {
    tenantDb = await getTenantRpcClientById(tenantId);
  } catch (e) {
    const r = tenantRoutingError(e);
    return json(r.status, r.body);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // ─── dispatch ──────────────────────────────────────────────────────
  try {
    switch (op) {
      case 'current_staff': {
        const { data, error } = await tenantAny
          .rpc('eq_cards_current_staff', { p_tenant_id: tenantId, p_user_id: userId });
        if (error) { const r = rpcError('current_staff', error); return json(r.status, r.body); }
        const staff = Array.isArray(data) && data.length > 0 ? data[0] : null;
        return json(200, { ok: true, staff });
      }

      case 'list_my_licences': {
        const { data, error } = await tenantAny
          .rpc('eq_cards_list_my_licences', { p_tenant_id: tenantId, p_user_id: userId });
        if (error) { const r = rpcError('list_my_licences', error); return json(r.status, r.body); }
        return json(200, { ok: true, licences: data ?? [] });
      }

      case 'upsert_my_licence': {
        let body: { payload?: unknown };
        try { body = (await req.json()) as { payload?: unknown }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
        if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
          return json(400, { ok: false, error: 'invalid_payload', detail: 'payload must be a JSON object' });
        }
        const { data, error } = await tenantAny
          .rpc('eq_cards_upsert_my_licence', { p_tenant_id: tenantId, p_user_id: userId, p_payload: body.payload });
        if (error) { const r = rpcError('upsert_my_licence', error); return json(r.status, r.body); }
        const licence = Array.isArray(data) && data.length > 0 ? data[0] : null;
        if (!licence) return json(500, { ok: false, error: 'rpc_returned_empty' });
        return json(200, { ok: true, licence });
      }

      case 'upsert_my_profile': {
        let body: { payload?: unknown };
        try { body = (await req.json()) as { payload?: unknown }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
        if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
          return json(400, { ok: false, error: 'invalid_payload', detail: 'payload must be a JSON object' });
        }
        const { data, error } = await tenantAny
          .rpc('eq_cards_upsert_my_profile', { p_tenant_id: tenantId, p_user_id: userId, p_payload: body.payload });
        if (error) { const r = rpcError('upsert_my_profile', error); return json(r.status, r.body); }
        const profile = Array.isArray(data) && data.length > 0 ? data[0] : null;
        if (!profile) return json(500, { ok: false, error: 'rpc_returned_empty' });
        return json(200, { ok: true, profile });
      }

      case 'soft_delete_my_licence': {
        let body: { licence_id?: string };
        try { body = (await req.json()) as { licence_id?: string }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
        if (!body.licence_id || !UUID_RE.test(body.licence_id)) {
          return json(400, { ok: false, error: 'invalid_licence_id' });
        }
        const { error } = await tenantAny
          .rpc('eq_cards_soft_delete_my_licence', {
            p_tenant_id:  tenantId,
            p_user_id:    userId,
            p_licence_id: body.licence_id,
          });
        if (error) {
          // 'not found or not yours' from the RPC maps to 404 for the
          // Flutter side so it can render the right empty state.
          if (/licence not found/i.test(error.message)) return json(404, { ok: false, error: 'licence_not_found' });
          const r = rpcError('soft_delete_my_licence', error);
          return json(r.status, r.body);
        }
        return json(200, { ok: true });
      }
    }
  } catch (e) {
    console.error('[cards-api] dispatch failed', { op, error: (e as Error).message });
    return json(500, { ok: false, error: 'internal_error', detail: (e as Error).message });
  }

  // Unreachable in practice — every op case above returns. Belt-and-braces
  // for TS exhaustiveness: if a new op is added to READ_OPS / WRITE_OPS
  // without a switch case, this 500 ships rather than a silent undefined.
  console.error('[cards-api] op handled none of the switch cases', { op });
  return json(500, { ok: false, error: 'internal_error', detail: `op '${op}' has no handler` });
});

// Client IP for per-attacker throttling. Netlify sets
// x-nf-client-connection-ip authoritatively (not client-settable);
// x-forwarded-for is a client-influenced fallback, so take only the first hop
// and only when the trusted header is absent. Returns null if neither is
// present — callers fail open (the per-slug DB throttle still applies).
function clientIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip');
  if (nf && nf.trim()) return nf.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff && xff.trim()) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

interface PartialResponse { status: number; body: ErrBody }

function rpcError(op: string, error: { message: string }): PartialResponse {
  console.error('[cards-api] rpc failed', { op, error: error.message });
  return { status: 500, body: { ok: false, error: 'tenant_rpc_failed', detail: error.message } };
}

function tenantRoutingError(e: unknown): PartialResponse {
  if (e instanceof TenantNotFoundError) {
    return { status: 500, body: { ok: false, error: 'tenant_not_provisioned', detail: e.identifier } };
  }
  if (e instanceof TenantNotActiveError) {
    return { status: 503, body: { ok: false, error: 'tenant_inactive', detail: e.status } };
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cards-api] tenant routing misconfigured', e);
    return { status: 500, body: { ok: false, error: 'routing_misconfigured' } };
  }
  console.error('[cards-api] unexpected tenant resolution error', e);
  return { status: 500, body: { ok: false, error: 'internal_error' } };
}
