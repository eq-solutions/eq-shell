// POST /.netlify/functions/quote-email
// Body: { quote_id: string; to_email: string; to_name?: string }
//
// Generates a PDF for the quote and sends it via Resend as an attachment.
// Auth: session cookie → tenant routing.

import type { Context } from '@netlify/functions';
import {
  getTenantRpcClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';
import { generateQuotePdf, loadQuotePdfData } from './_shared/quote-pdf.js';

function jsonErr(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function routingErr(e: unknown): Response {
  if (e instanceof TenantNotFoundError)    return jsonErr(404, 'tenant_not_found');
  if (e instanceof TenantNotActiveError)   return jsonErr(403, 'tenant_inactive');
  if (e instanceof TenantRoutingMisconfiguredError) return jsonErr(500, 'routing_misconfigured');
  return jsonErr(500, 'routing_error');
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed');

  const cookie = readSessionCookie(req);
  if (!cookie) return jsonErr(401, 'no_session');

  let session: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    session = await verifySessionToken(cookie);
  } catch {
    return jsonErr(401, 'invalid_session');
  }

  let body: { quote_id?: string; to_email?: string; to_name?: string };
  try {
    body = await req.json() as { quote_id?: string; to_email?: string; to_name?: string };
  } catch {
    return jsonErr(400, 'invalid_json');
  }

  const { quote_id, to_email, to_name } = body;
  if (!quote_id)  return jsonErr(400, 'quote_id_required');
  if (!to_email)  return jsonErr(400, 'to_email_required');

  let supabase: Awaited<ReturnType<typeof getTenantRpcClientById>>;
  try {
    supabase = await getTenantRpcClientById(session.tenant_id);
  } catch (e) {
    return routingErr(e);
  }

  const data = await loadQuotePdfData(supabase, quote_id);
  if (!data) return jsonErr(404, 'quote_not_found');

  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateQuotePdf(data);
  } catch (e) {
    console.error('[quote-email] puppeteer error:', e);
    return jsonErr(500, 'pdf_generation_failed');
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return jsonErr(500, 'email_not_configured');
  }

  const from = (process.env.EMAIL_FROM ?? 'SKS Technologies <noreply@eq.solutions>').trim();
  const quoteNumber = data.quote.quote_number;
  const filename = `SKS-${quoteNumber.replace(/[^A-Z0-9-]/gi, '-')}.pdf`;
  const projectLabel = data.quote.project_name ? ` — ${data.quote.project_name}` : '';
  const recipient = to_name ? `${to_name} <${to_email}>` : to_email;

  const payload = {
    from,
    to: [recipient],
    subject: `Quote ${quoteNumber}${projectLabel}`,
    text: `Please find attached Quote ${quoteNumber} from SKS Technologies.\n\nIf you have any questions, please don't hesitate to get in touch.`,
    attachments: [{
      filename,
      content: pdfBytes.toString('base64'),
    }],
  };

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[quote-email] resend network error:', e);
    return jsonErr(500, 'email_send_failed');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => `HTTP ${res.status}`);
    console.error('[quote-email] resend error:', res.status, detail);
    return new Response(JSON.stringify({ ok: false, error: `email_send_failed`, detail: `HTTP ${res.status}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const resBody = await res.json() as { id: string };

  // Audit the send on the quote timeline (best-effort)
  await supabase.rpc('eq_add_quote_note', {
    p_quote_id: quote_id,
    p_body: `Quote PDF emailed to ${to_email}`,
    p_note_type: 'system',
    p_initials: null,
  }).catch(() => { /* non-fatal */ });

  return new Response(JSON.stringify({ ok: true, message_id: resBody.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
