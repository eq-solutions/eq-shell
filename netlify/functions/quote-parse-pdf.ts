// POST /.netlify/functions/quote-parse-pdf
// Body: { pdf_base64: string }   — caller converts File to base64 in the browser
// Returns: ParsedQuotePdf | { ok: false, error: string }
//
// Sends the PDF to Claude via the document content block. Returns structured
// fields to pre-fill the create/edit form. Never touches the DB.

import type { Context } from '@netlify/functions';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const PARSE_MODEL = 'claude-sonnet-4-6';
const PARSE_MAX_TOKENS = 2048;

const PARSE_TOOL = {
  name: 'submit_parsed_quote',
  description: 'Submit the structured data extracted from the quote PDF.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_name:       { type: 'string', description: 'Company name of the customer / client.' },
      site_name:           { type: 'string', description: 'Site or location name.' },
      project_name:        { type: 'string', description: 'Project title or description.' },
      estimator_name:      { type: 'string', description: 'Full name of the estimator / author.' },
      estimator_initials:  { type: 'string', description: 'Initials of the estimator.' },
      scope:               { type: 'string', description: 'Full Scope of Works text.' },
      clarifications:      { type: 'string', description: 'Clarifications, exclusions, and conditions.' },
      attn_first_name:     { type: 'string', description: 'Attention contact first name.' },
      attn_last_name:      { type: 'string', description: 'Attention contact last name / surname.' },
      attn_phone:          { type: 'string', description: 'Attention contact phone number.' },
      address:             { type: 'string', description: 'Full mailing address.' },
      payment_terms:       { type: 'string', description: 'Payment terms string, e.g. "30 days".' },
      line_items: {
        type: 'array',
        description: 'Line items from the quote table.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            qty:         { type: 'number' },
            unit:        { type: 'string' },
            rate:        { type: 'number', description: 'Sell rate per unit in AUD.' },
            cost:        { type: 'number', description: 'Cost / buy rate per unit in AUD if shown.' },
            category:    { type: 'string', enum: ['labour', 'material', 'subcontractor', 'one_off'] },
          },
          required: ['description'],
        },
      },
    },
    required: [],
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const cookie = readSessionCookie(req);
  if (!cookie) return json(401, { ok: false, error: 'no_session' });
  try {
    await verifySessionToken(cookie);
  } catch {
    return json(401, { ok: false, error: 'invalid_session' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { ok: false, error: 'ai_not_configured' });

  let body: { pdf_base64?: string };
  try {
    body = await req.json() as { pdf_base64?: string };
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  if (!body.pdf_base64?.trim()) return json(400, { ok: false, error: 'missing_pdf' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: PARSE_MAX_TOKENS,
        tools: [PARSE_TOOL],
        tool_choice: { type: 'tool', name: 'submit_parsed_quote' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: body.pdf_base64,
              },
            },
            {
              type: 'text',
              text: 'Extract all available quote information from this PDF and call submit_parsed_quote. Only include fields you can clearly identify — omit fields that are absent or unclear.',
            },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json(502, { ok: false, error: `upstream_error: ${resp.status}`, detail: errText });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as { content: any[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = data.content?.find((b: any) => b.type === 'tool_use' && b.name === 'submit_parsed_quote');
    if (!toolUse) return json(502, { ok: false, error: 'no_tool_use' });

    return json(200, { ok: true, ...toolUse.input });
  } catch (err) {
    return json(500, { ok: false, error: 'internal_error', detail: String(err) });
  }
});
