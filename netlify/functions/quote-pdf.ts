// POST /.netlify/functions/quote-pdf
// Body: { quote_id: string }
//
// Returns a binary PDF of the quote for authenticated users.
// Auth: session cookie → tenant routing → supabase client.

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

  let body: { quote_id?: string };
  try {
    body = await req.json() as { quote_id?: string };
  } catch {
    return jsonErr(400, 'invalid_json');
  }

  const { quote_id } = body;
  if (!quote_id) return jsonErr(400, 'quote_id_required');

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
    console.error('[quote-pdf] puppeteer error:', e);
    return jsonErr(500, 'pdf_generation_failed');
  }

  const filename = `SKS-${data.quote.quote_number.replace(/[^A-Z0-9-]/gi, '-')}.pdf`;
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
