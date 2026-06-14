// POST /.netlify/functions/quote-accept
// Body: { tenant: string; token: string; decision: 'accept' | 'decline'; client_name?: string; client_note?: string }
//
// Unauthenticated accept/decline endpoint for the client portal.
// Uses service_role since eq_respond_portal_quote has no authenticated grant.

import type { Context } from '@netlify/functions';
import {
  getTenantRpcClient,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { withSentry } from './_shared/sentry.js';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface AcceptBody {
  tenant?: string;
  token?: string;
  decision?: string;
  client_name?: string;
  client_note?: string;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonResp(405, { ok: false, error: 'method_not_allowed' });

  let body: AcceptBody;
  try {
    body = await req.json() as AcceptBody;
  } catch {
    return jsonResp(400, { ok: false, error: 'invalid_json' });
  }

  const { tenant, token, decision, client_name, client_note } = body;

  if (!tenant)   return jsonResp(400, { ok: false, error: 'tenant_required' });
  if (!token)    return jsonResp(400, { ok: false, error: 'token_required' });
  if (decision !== 'accept' && decision !== 'decline') {
    return jsonResp(400, { ok: false, error: 'decision_must_be_accept_or_decline' });
  }

  let supabase: Awaited<ReturnType<typeof getTenantRpcClient>>;
  try {
    supabase = await getTenantRpcClient(tenant);
  } catch (e) {
    if (e instanceof TenantNotFoundError)    return jsonResp(404, { ok: false, error: 'tenant_not_found' });
    if (e instanceof TenantNotActiveError)   return jsonResp(403, { ok: false, error: 'tenant_inactive' });
    if (e instanceof TenantRoutingMisconfiguredError) return jsonResp(500, { ok: false, error: 'routing_misconfigured' });
    return jsonResp(500, { ok: false, error: 'routing_error' });
  }

  const { data, error } = await supabase.rpc('eq_respond_portal_quote', {
    p_token:       token,
    p_decision:    decision,
    p_client_name: client_name ?? null,
    p_client_note: client_note ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('link_not_found'))   return jsonResp(404, { ok: false, error: 'link_not_found' });
    if (msg.includes('link_expired'))     return jsonResp(410, { ok: false, error: 'link_expired' });
    if (msg.includes('already_responded')) return jsonResp(409, { ok: false, error: 'already_responded' });
    console.error('[quote-accept] rpc error:', error);
    return jsonResp(500, { ok: false, error: 'rpc_error' });
  }

  return jsonResp(200, { ok: true, decision, data });
});
