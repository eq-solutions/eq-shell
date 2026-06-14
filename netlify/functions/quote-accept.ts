// POST /.netlify/functions/quote-accept
// Body: { tenant: string; token: string; decision: 'accept' | 'decline'; client_name?: string; client_note?: string }
//
// Unauthenticated accept/decline endpoint for the client portal.
// Uses service_role since eq_respond_portal_quote has no authenticated grant.
//
// After a successful response, fires a best-effort Resend email to
// PORTAL_NOTIFY_EMAIL (if set in Netlify env) so the estimator is notified.

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

function fmtMoney(cents: number | null): string {
  if (!cents) return '';
  return '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0 });
}

async function sendPortalNotification(opts: {
  decision: string;
  quoteNumber: string | null;
  projectName: string | null;
  estimatorName: string | null;
  totalCents: number | null;
  clientName: string | null;
}): Promise<void> {
  const notifyEmail = process.env.PORTAL_NOTIFY_EMAIL;
  const resendKey   = process.env.RESEND_API_KEY;
  if (!notifyEmail || !resendKey) return;

  const isAccept  = opts.decision === 'accept';
  const subject   = isAccept
    ? `Quote ${opts.quoteNumber ?? ''} ACCEPTED by client`
    : `Quote ${opts.quoteNumber ?? ''} declined by client`;

  const lines = [
    `<b>Decision:</b> ${isAccept ? '✅ Accepted' : '❌ Declined'}`,
    opts.quoteNumber   && `<b>Quote:</b> ${opts.quoteNumber}`,
    opts.projectName   && `<b>Project:</b> ${opts.projectName}`,
    opts.clientName    && `<b>Client name:</b> ${opts.clientName}`,
    opts.totalCents    && `<b>Value:</b> ${fmtMoney(opts.totalCents)} inc GST`,
    opts.estimatorName && `<b>Estimator:</b> ${opts.estimatorName}`,
  ].filter(Boolean).join('<br>');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'EQ Ops <noreply@eq.solutions>',
      to:      [notifyEmail],
      subject,
      html:    `<p>${lines}</p>`,
    }),
  }).catch((e) => {
    console.warn('[quote-accept] notification email failed (best-effort):', e);
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
    if (msg.includes('link_not_found'))    return jsonResp(404, { ok: false, error: 'link_not_found' });
    if (msg.includes('link_expired'))      return jsonResp(410, { ok: false, error: 'link_expired' });
    if (msg.includes('already_responded')) return jsonResp(409, { ok: false, error: 'already_responded' });
    console.error('[quote-accept] rpc error:', error);
    return jsonResp(500, { ok: false, error: 'rpc_error' });
  }

  // Best-effort notification — do not await, does not affect client response
  const d = (data ?? {}) as Record<string, unknown>;
  void sendPortalNotification({
    decision,
    quoteNumber:   d.quote_number   ? String(d.quote_number)   : null,
    projectName:   d.project_name   ? String(d.project_name)   : null,
    estimatorName: d.estimator_name ? String(d.estimator_name) : null,
    totalCents:    d.total_cents     ? Number(d.total_cents)    : null,
    clientName:    client_name ?? null,
  });

  return jsonResp(200, { ok: true, decision, data });
});
