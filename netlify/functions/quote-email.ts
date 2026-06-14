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
  if (!session) return jsonErr(401, 'invalid_session');

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

  // Greeting — prefer first name from the quote's attn field, fall back to the supplied to_name
  const firstNameFromQuote = data.quote.attn_first_name?.trim() || null;
  const firstNameFromParam = to_name?.trim().split(/\s+/)[0] || null;
  const firstName = firstNameFromQuote || firstNameFromParam;
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  const fmtAud = (cents: number) =>
    (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const validity = data.quote.validity_days ?? 30;
  const totalFormatted = `$${fmtAud(data.quote.total_cents)} (inc. GST)`;
  const companyLine = data.customer.company_name ? `\n${data.customer.company_name}` : '';
  const projectLine = data.quote.project_name ? `\nProject:  ${data.quote.project_name}` : '';
  const contactLine = data.quote.estimator_name
    ? `Please contact ${data.quote.estimator_name} if you have any questions.`
    : `If you have any questions, please don't hesitate to get in touch.`;

  const textBody = [
    greeting,
    '',
    `Please find attached Quote ${quoteNumber} from SKS Technologies.`,
    companyLine + projectLine,
    `Total:    ${totalFormatted}`,
    `Valid for ${validity} days from date of issue.`,
    '',
    contactLine,
    '',
    'Regards,',
    'SKS Technologies',
  ].join('\n');

  const esc = (s: string | null | undefined) =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;font-size:14px;color:#222;margin:0;padding:0;background:#f5f5f5}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e0e0e0}
  .header{background:#1F335C;padding:24px 32px}
  .header h1{color:#fff;font-size:20px;margin:0;font-weight:700}
  .body{padding:28px 32px}
  p{margin:0 0 14px;line-height:1.6}
  .meta{background:#f8fafc;border:1px solid #e8edf2;border-radius:4px;padding:14px 18px;margin:20px 0}
  .meta table{border-collapse:collapse;width:100%}
  .meta td{padding:5px 0;font-size:13px;vertical-align:top}
  .meta td:first-child{color:#555;width:110px}
  .meta td:last-child{font-weight:600;color:#1F335C}
  .footer{border-top:1px solid #eee;padding:16px 32px;font-size:12px;color:#888}
</style>
</head><body>
<div class="wrap">
  <div class="header"><h1>SKS Technologies</h1></div>
  <div class="body">
    <p>${esc(greeting)}</p>
    <p>Please find attached <strong>Quote ${esc(quoteNumber)}</strong>${data.customer.company_name ? ` for <strong>${esc(data.customer.company_name)}</strong>` : ''}.${data.quote.project_name ? `<br>Project: ${esc(data.quote.project_name)}` : ''}</p>
    <div class="meta">
      <table>
        <tr><td>Quote number</td><td>${esc(quoteNumber)}</td></tr>
        ${data.quote.project_name ? `<tr><td>Project</td><td>${esc(data.quote.project_name)}</td></tr>` : ''}
        <tr><td>Total (inc. GST)</td><td>${esc(totalFormatted)}</td></tr>
        <tr><td>Valid for</td><td>${validity} days from date of issue</td></tr>
      </table>
    </div>
    <p>${esc(contactLine)}</p>
    <p>Regards,<br><strong>SKS Technologies</strong></p>
  </div>
  <div class="footer">This email was sent from EQ Ops. Quote ${esc(quoteNumber)} is attached as a PDF.</div>
</div>
</body></html>`;

  const payload = {
    from,
    to: [recipient],
    subject: `Quote ${quoteNumber}${projectLabel}`,
    text: textBody,
    html: htmlBody,
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

  // Stamp sent_at and audit the send (best-effort; non-fatal)
  await Promise.all([
    supabase.rpc('eq_set_sent_at', {
      p_quote_id: quote_id,
      p_sent_at: new Date().toISOString(),
      p_initials: null,
    }),
    supabase.rpc('eq_add_quote_note', {
      p_quote_id: quote_id,
      p_body: `Quote PDF emailed to ${to_email}`,
      p_note_type: 'system',
      p_initials: null,
    }),
  ]).catch(() => { /* non-fatal */ });

  return new Response(JSON.stringify({ ok: true, message_id: resBody.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
