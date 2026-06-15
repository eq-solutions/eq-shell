// POST /.netlify/functions/quote-parse-subcontractor
//
// Accepts a JSON body: { file_base64: string, mime_type: string, file_name?: string }
// Sends the document to Claude and extracts structured quote data from a subcontractor quote.
// Returns: { ok: true, supplier_name?, quote_ref?, project_name?, scope_summary?, address?,
//            items: [{ description, qty, unit, unit_price }] }
//        | { ok: false, error: string }
//
// Auth: session cookie (same gate as quote-suggest-scope).
// AI key: ANTHROPIC_API_KEY Netlify env var (already present for quote-suggest-scope).

import { withSentry, captureServerError } from './_shared/sentry.js'
import { verifySessionToken, readSessionCookie } from './_shared/token.js'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const ANTHROPIC_API_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

const EXTRACT_TOOL = {
  name: 'extract_line_items',
  description: 'Extract structured data from a subcontractor quote: project context plus all priced line items.',
  input_schema: {
    type: 'object' as const,
    required: ['items'],
    properties: {
      supplier_name: {
        type: 'string',
        description: 'Name of the supplier or subcontractor who issued this quote, if identifiable.',
      },
      quote_ref: {
        type: 'string',
        description: "The supplier's own quote number or reference, if present.",
      },
      project_name: {
        type: 'string',
        description: 'The project name, job description, or description of works as stated in the quote.',
      },
      scope_summary: {
        type: 'string',
        description: 'A concise summary (1–3 sentences) of the scope of works described in the quote — what is being supplied or installed.',
      },
      address: {
        type: 'string',
        description: 'The site or delivery address if stated in the quote.',
      },
      items: {
        type: 'array',
        description: 'Every priced line item in the quote.',
        items: {
          type: 'object',
          required: ['description', 'unit_price'],
          properties: {
            description: {
              type: 'string',
              description: 'Full description of the item or service as written in the quote.',
            },
            qty: {
              type: 'number',
              description: 'Quantity. Default to 1 if not explicitly stated.',
            },
            unit: {
              type: 'string',
              description: 'Unit of measure (e.g. ea, hr, m, lm). Omit if not stated.',
            },
            unit_price: {
              type: 'number',
              description: 'Unit price in AUD dollars (not cents). If only a line total is given and qty > 1, divide to get the unit price.',
            },
          },
        },
      },
    },
  },
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' })

  const session = verifySessionToken(readSessionCookie(req))
  if (!session) return json(401, { ok: false, error: 'not_signed_in' })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  const { file_base64, mime_type } = body
  if (typeof file_base64 !== 'string' || !file_base64) {
    return json(400, { ok: false, error: 'file_base64_required' })
  }
  if (typeof mime_type !== 'string' || !ALLOWED_TYPES.includes(mime_type)) {
    return json(415, { ok: false, error: 'unsupported_type' })
  }

  const fileBytes = Buffer.from(file_base64, 'base64')
  if (fileBytes.length > MAX_BYTES) {
    return json(413, { ok: false, error: 'file_too_large' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json(503, { ok: false, error: 'ai_not_configured' })

  // PDF → document content block; images → image content block
  const contentBlock = mime_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mime_type, data: file_base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime_type, data: file_base64 } }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'extract_line_items' },
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: 'Extract structured data from this subcontractor quote using the extract_line_items tool. Capture the project name, scope summary, site address, supplier details, and every priced line item. For lump-sum lines with no explicit quantity use qty 1. All prices in AUD.',
            },
          ],
        }],
      }),
    })

    if (!resp.ok) {
      throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as { content: any[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = data.content?.find((b: any) => b.type === 'tool_use' && b.name === 'extract_line_items')
    if (!toolUse) throw new Error('Claude did not call extract_line_items')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = toolUse.input as {
      supplier_name?: string
      quote_ref?: string
      project_name?: string
      scope_summary?: string
      address?: string
      items?: any[]
    }

    return json(200, {
      ok: true,
      supplier_name: out.supplier_name?.trim() || undefined,
      quote_ref: out.quote_ref?.trim() || undefined,
      project_name: out.project_name?.trim() || undefined,
      scope_summary: out.scope_summary?.trim() || undefined,
      address: out.address?.trim() || undefined,
      items: (out.items ?? [])
        .map((it) => ({
          description: String(it.description ?? '').trim(),
          qty: typeof it.qty === 'number' && it.qty > 0 ? it.qty : 1,
          unit: typeof it.unit === 'string' ? it.unit.trim() : '',
          unit_price: typeof it.unit_price === 'number' ? it.unit_price : 0,
        }))
        .filter((it) => it.description),
    })
  } catch (e) {
    captureServerError(e, { context: 'quote-parse-subcontractor' })
    console.error('[quote-parse-subcontractor] failed:', (e as Error).message)
    return json(500, { ok: false, error: 'extraction_failed' })
  }
})
