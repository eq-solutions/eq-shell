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
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySupabaseJwt, readBearerJwt } from './_shared/supabase-jwt.js';
import { withSentry } from './_shared/sentry.js';

type Op = 'current_staff' | 'list_my_licences' | 'upsert_my_licence' | 'soft_delete_my_licence';

const READ_OPS:  ReadonlySet<Op> = new Set<Op>(['current_staff', 'list_my_licences']);
const WRITE_OPS: ReadonlySet<Op> = new Set<Op>(['upsert_my_licence', 'soft_delete_my_licence']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OkBody { ok: true; [k: string]: unknown }
interface ErrBody { ok: false; error: string; detail?: string }

function json(status: number, body: OkBody | ErrBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
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
    return json(400, { ok: false, error: 'unknown_op', detail: 'op must be one of: current_staff, list_my_licences, upsert_my_licence, soft_delete_my_licence' });
  }
  const isWrite = WRITE_OPS.has(op);
  if (isWrite && req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed', detail: 'write ops require POST' });
  if (!isWrite && req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // ─── open tenant DB ────────────────────────────────────────────────
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // ─── dispatch ──────────────────────────────────────────────────────
  try {
    switch (op) {
      case 'current_staff': {
        const { data, error } = await tenantAny
          .schema('public')
          .rpc('eq_cards_current_staff', { p_tenant_id: tenantId, p_user_id: userId });
        if (error) return rpcError('current_staff', error);
        const staff = Array.isArray(data) && data.length > 0 ? data[0] : null;
        return json(200, { ok: true, staff });
      }

      case 'list_my_licences': {
        const { data, error } = await tenantAny
          .schema('public')
          .rpc('eq_cards_list_my_licences', { p_tenant_id: tenantId, p_user_id: userId });
        if (error) return rpcError('list_my_licences', error);
        return json(200, { ok: true, licences: data ?? [] });
      }

      case 'upsert_my_licence': {
        let body: { payload?: unknown };
        try { body = (await req.json()) as { payload?: unknown }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
        if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
          return json(400, { ok: false, error: 'invalid_payload', detail: 'payload must be a JSON object' });
        }
        const { data, error } = await tenantAny
          .schema('public')
          .rpc('eq_cards_upsert_my_licence', { p_tenant_id: tenantId, p_user_id: userId, p_payload: body.payload });
        if (error) return rpcError('upsert_my_licence', error);
        const licence = Array.isArray(data) && data.length > 0 ? data[0] : null;
        if (!licence) return json(500, { ok: false, error: 'rpc_returned_empty' });
        return json(200, { ok: true, licence });
      }

      case 'soft_delete_my_licence': {
        let body: { licence_id?: string };
        try { body = (await req.json()) as { licence_id?: string }; } catch { return json(400, { ok: false, error: 'invalid_body' }); }
        if (!body.licence_id || !UUID_RE.test(body.licence_id)) {
          return json(400, { ok: false, error: 'invalid_licence_id' });
        }
        const { error } = await tenantAny
          .schema('public')
          .rpc('eq_cards_soft_delete_my_licence', {
            p_tenant_id:  tenantId,
            p_user_id:    userId,
            p_licence_id: body.licence_id,
          });
        if (error) {
          // 'not found or not yours' from the RPC maps to 404 for the
          // Flutter side so it can render the right empty state.
          if (/licence not found/i.test(error.message)) return json(404, { ok: false, error: 'licence_not_found' });
          return rpcError('soft_delete_my_licence', error);
        }
        return json(200, { ok: true });
      }
    }
  } catch (e) {
    console.error('[cards-api] dispatch failed', { op, error: (e as Error).message });
    return json(500, { ok: false, error: 'internal_error', detail: (e as Error).message });
  }
});

function rpcError(op: string, error: { message: string }): Response {
  console.error('[cards-api] rpc failed', { op, error: error.message });
  return json(500, { ok: false, error: 'tenant_rpc_failed', detail: error.message });
}

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cards-api] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[cards-api] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
