// GET /.netlify/functions/provision-status?tenant_id=<uuid>
//
// Platform-admin only. Returns the current provisioning state of a tenant
// data-plane from shell_control.tenant_routing.
//
// Responses:
//   { status: 'not_provisioned' }                             — no routing row
//   { status, status_changed_at?, last_error?, last_error_at?, supabase_url? }
//
// The UI polls this every 3s while status=provisioning.

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

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Platform admin only
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (!session.is_platform_admin) return jsonResponse(403, { error: 'Platform admin only' });

  const tenantId = new URL(req.url).searchParams.get('tenant_id')?.trim();
  if (!tenantId) return jsonResponse(400, { error: 'tenant_id query param required' });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data, error } = await sb
    .from('tenant_routing')
    .select('status, last_error, last_error_at, supabase_url, status_changed_at')
    .eq('tenant_id', tenantId)
    .maybeSingle<{
      status: string;
      last_error: string | null;
      last_error_at: string | null;
      supabase_url: string | null;
      status_changed_at: string | null;
    }>();

  if (error) return jsonResponse(500, { error: error.message });
  if (!data) return jsonResponse(200, { status: 'not_provisioned' });

  return jsonResponse(200, {
    status: data.status,
    status_changed_at: data.status_changed_at,
    last_error: data.last_error,
    last_error_at: data.last_error_at,
    supabase_url: data.supabase_url,
  });
});
