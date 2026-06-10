// POST /.netlify/functions/anthropic-proxy
//
// Server-side proxy for Anthropic API calls from the browser.
// Anthropic blocks direct browser requests (CORS policy), so
// AnthropicProvider (in @eq/ai) sets baseUrl to point here instead of
// hitting api.anthropic.com directly.
//
// URL pattern the caller uses:
//   POST /api/anthropic-proxy/messages
//   (AnthropicProvider appends "/messages" to the configured baseUrl)
//
// The function strips the "/api/anthropic-proxy" prefix, keeps the rest of
// the path (e.g. "/messages"), and forwards to
//   https://api.anthropic.com/v1/<path>
//
// The real ANTHROPIC_API_KEY is injected server-side from the Netlify env var
// and is never sent to the browser.
//
// If the API key is absent the function returns 503 and the IntakeModule
// degrades gracefully to heuristic-only classification.

import type { Context } from '@netlify/functions';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// CORS — permit the browser call from the same-origin shell page.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Anthropic API key not configured on server' }),
      {
        status: 503,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  // Extract the Anthropic sub-path from the request URL.
  // The AnthropicProvider calls: <baseUrl>/messages
  // Netlify mounts this at /api/anthropic-proxy, so the full URL is
  // /api/anthropic-proxy/messages — we extract "/messages" from that.
  const url = new URL(req.url);
  const prefixRe = /^\/api\/anthropic-proxy/;
  const subPath = url.pathname.replace(prefixRe, '') || '/messages';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Return the Anthropic response verbatim (status + body).
  const upstream = await anthropicResp.text();
  return new Response(upstream, {
    status: anthropicResp.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': anthropicResp.headers.get('Content-Type') ?? 'application/json',
    },
  });
}

export const config = {
  path: '/api/anthropic-proxy/*',
};
