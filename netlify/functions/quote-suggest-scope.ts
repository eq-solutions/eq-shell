// POST /.netlify/functions/quote-suggest-scope
// Body: ScopeInput (customer_name?, project_name?, site?, brief?, line_items?[], existing_scope?)
// Returns: { ok: true, scope: string, clarifications?: string } | { ok: false, error: string }
//
// Drafts a Scope of Works for a quote from the estimator's brief + line items.
// Auth: session cookie (same as quote-pdf). The Anthropic key is read server-side
// from the Netlify env var and never reaches the browser; absent key → 503 and
// the create form degrades gracefully (the button just reports "not configured").
//
// v1 is prompt-only — no tenant DB read, no embeddings. pgvector grounding (draw
// on the customer's past scopes) is the documented fast-follow.

import type { Context } from '@netlify/functions';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';
import { buildScopePrompt, type ScopeInput } from './_shared/quote-suggest-scope-prompt.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
// Sonnet — a customer-facing scope draft is quality-sensitive prose, worth the
// extra latency over Haiku on an on-demand button.
const SCOPE_MODEL = 'claude-sonnet-4-6';
const SCOPE_MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are an estimating assistant at SKS Technologies, an electrical, communications, audiovisual and data-centre services contractor operating in New South Wales, Australia.

Your job: draft a professional Scope of Works for a quote, from the estimator's brief and the line items provided.

RULES:
- Always respond via the submit_quote_scope tool. Never reply in free text.
- Write in plain, professional English with Australian spelling (labour, metre, organise, etc.).
- Structure it well: short paragraphs and/or a tight list of the works to be carried out. Where relevant to the brief, cover supply, installation, testing & commissioning, and make-good.
- GROUNDING: base every statement on the brief and line items given. Do NOT invent prices, quantities, dates, brands, or site details that were not provided. If the brief is thin, produce a sensible professional draft the estimator will refine — breadth over false precision.
- Describe only what SKS delivers. Do not promise client-side obligations.
- clarifications (optional): standard assumptions, inclusions/exclusions and clarifications that protect SKS — e.g. "Works carried out during normal business hours unless otherwise stated", "Price excludes builder's works, patching and making good", "Assumes clear and safe site access". One per line. Only include clarifications that are reasonable given the brief.
- This is a DRAFT for an estimator to review and edit — usefulness and accuracy matter more than length.`;

const SUBMIT_SCOPE_TOOL = {
  name: 'submit_quote_scope',
  description: 'Submit the drafted scope of works (and optional clarifications) for the quote.',
  input_schema: {
    type: 'object' as const,
    required: ['scope'],
    properties: {
      scope: {
        type: 'string',
        description: 'The Scope of Works. Plain English, Australian spelling, no markdown headings — paragraphs and/or hyphen-prefixed bullet lines only.',
      },
      clarifications: {
        type: 'string',
        description: 'Optional. Standard assumptions, inclusions/exclusions and clarifications that protect SKS, one per line. Omit entirely if none are warranted.',
      },
    },
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

  let body: ScopeInput;
  try {
    body = await req.json() as ScopeInput;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const hasContext =
    !!body.brief?.trim() ||
    !!body.project_name?.trim() ||
    (body.line_items?.some((s) => s.trim()) ?? false);
  if (!hasContext) return json(400, { ok: false, error: 'need_brief' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { ok: false, error: 'ai_not_configured' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: SCOPE_MODEL,
        max_tokens: SCOPE_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [SUBMIT_SCOPE_TOOL],
        tool_choice: { type: 'tool', name: 'submit_quote_scope' },
        messages: [{ role: 'user', content: buildScopePrompt(body) }],
      }),
    });

    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as { content: any[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = data.content?.find((b: any) => b.type === 'tool_use' && b.name === 'submit_quote_scope');
    if (!toolUse) throw new Error('Claude did not call submit_quote_scope');

    const out = toolUse.input as { scope?: string; clarifications?: string };
    const scope = (out.scope ?? '').trim();
    if (!scope) throw new Error('empty scope returned');

    return json(200, {
      ok: true,
      scope,
      clarifications: out.clarifications?.trim() || undefined,
    });
  } catch (e) {
    captureServerError(e, { context: 'quote-suggest-scope' });
    console.error('[quote-suggest-scope] generation failed:', (e as Error).message);
    return json(500, { ok: false, error: 'generation_failed', detail: (e as Error).message });
  }
});
