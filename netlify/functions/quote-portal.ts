// GET /.netlify/functions/quote-portal?tenant=<slug>&token=<token>
//
// Unauthenticated portal data endpoint. Returns the quote data for a valid
// share link so the client portal page can render it.
// Uses service_role (via tenant routing) since eq_get_portal_quote is
// REVOKE ALL FROM PUBLIC — no authenticated grant.

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

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return jsonResp(405, { ok: false, error: 'method_not_allowed' });

  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant');
  const token  = url.searchParams.get('token');

  if (!tenant) return jsonResp(400, { ok: false, error: 'tenant_required' });
  if (!token)  return jsonResp(400, { ok: false, error: 'token_required' });

  let supabase: Awaited<ReturnType<typeof getTenantRpcClient>>;
  try {
    supabase = await getTenantRpcClient(tenant);
  } catch (e) {
    if (e instanceof TenantNotFoundError)    return jsonResp(404, { ok: false, error: 'tenant_not_found' });
    if (e instanceof TenantNotActiveError)   return jsonResp(403, { ok: false, error: 'tenant_inactive' });
    if (e instanceof TenantRoutingMisconfiguredError) return jsonResp(500, { ok: false, error: 'routing_misconfigured' });
    return jsonResp(500, { ok: false, error: 'routing_error' });
  }

  const { data, error } = await supabase.rpc('eq_get_portal_quote', { p_token: token });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('link_not_found')) return jsonResp(404, { ok: false, error: 'link_not_found' });
    if (msg.includes('link_expired'))   return jsonResp(410, { ok: false, error: 'link_expired' });
    console.error('[quote-portal] rpc error:', error);
    return jsonResp(500, { ok: false, error: 'rpc_error' });
  }

  return jsonResp(200, { ok: true, data });
});
