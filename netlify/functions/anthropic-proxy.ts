// POST /.netlify/functions/anthropic-proxy
//
// Server-side proxy for Anthropic API calls from the browser.
// Anthropic blocks direct browser requests (CORS policy), so
// AnthropicProvider (in @eq/ai) sets baseUrl to point here instead of
// hitting api.anthropic.com directly.
//
// SECURITY (2026-06-15): this endpoint was previously open to the internet —
// `Access-Control-Allow-Origin: *` and NO auth — so anyone could forward
// arbitrary requests through the server's ANTHROPIC_API_KEY (cost/DoS, open
// relay). It now (1) requires a valid EQ Shell session cookie and (2) only
// echoes CORS for *.eq.solutions origins. Callers must be signed in.
//
// URL pattern the caller uses:
//   POST /api/anthropic-proxy/messages
//   (AnthropicProvider appends "/messages" to the configured baseUrl)
// Forwards to https://api.anthropic.com/v1/<path>. The real ANTHROPIC_API_KEY
// is injected server-side from the Netlify env var and never sent to the browser.

import type { Context } from '@netlify/functions';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// CORS — only same-site EQ origins, with credentials so the HttpOnly session
// cookie rides cross-subdomain. No wildcard; unknown origins get no ACAO.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (/^https:\/\/([a-z0-9-]+\.)?eq\.solutions$/i.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const CORS = corsHeaders(req);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // AUTH — require a valid EQ Shell session. Without this the endpoint is an
  // open relay on the server's Anthropic key.
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured on server' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  // Extract the Anthropic sub-path from the request URL (e.g. "/messages").
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^\/api\/anthropic-proxy/, '') || '/messages';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Forward to Anthropic
  let anthropicResp: Response;
  try {
    anthropicResp = await fetch(`${ANTHROPIC_BASE}${subPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return new Response(JSON.stringify({ error: `Upstream fetch failed: ${msg}` }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Return the Anthropic response verbatim (status + body).
  const upstream = await anthropicResp.text();
  return new Response(upstream, {
    status: anthropicResp.status,
    headers: {
      ...CORS,
      'Content-Type': anthropicResp.headers.get('Content-Type') ?? 'application/json',
    },
  });
});

export const config = {
  path: '/api/anthropic-proxy/*',
};
