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
import { withSentry } from './_shared/sentry.js';

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
  | 'verify_pin';

const READ_OPS:  ReadonlySet<Op> = new Set<Op>(['current_staff', 'list_my_licences', 'list_licence_types', 'has_pin']);
const WRITE_OPS: ReadonlySet<Op> = new Set<Op>(['upsert_my_licence', 'soft_delete_my_licence', 'upsert_my_profile', 'set_pin', 'verify_pin']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OkBody { ok: true; [k: string]: unknown }
interface ErrBody { ok: false; error: string; detail?: string }

// Cards Flutter web lives at cards.eq.solutions and calls this function
// on core.eq.solutions — cross-origin. Native iOS/Android builds don't
// send an Origin header so CORS is a no-op for them; this only matters
// for the web build, but the web build is how Royce smoke-tests.
const ALLOWED_ORIGIN_EXACT = new Set<string>(['https://cards.eq.solutions']);
const ALLOWED_ORIGIN_RE    = /^https:\/\/deploy-preview-\d+--eq-cards\.netlify\.app$/;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  const ok = ALLOWED_ORIGIN_EXACT.has(origin) || ALLOWED_ORIGIN_RE.test(origin);
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
          if (error) return json(500, { ok: false, error: 'pin_rpc_failed', detail: error.message });
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
});

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
