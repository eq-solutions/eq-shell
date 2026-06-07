// POST /.netlify/functions/ocr-parse
//
// Accepts a JSON body: { file_base64: string, mime_type: string, file_name?: string }
// Authenticates with Google using the GOOGLE_DOC_AI_CREDENTIALS service account,
// sends the document to Document AI (Form Parser), and returns structured fields
// with per-field confidence scores.
//
// Credentials source (in order):
//   1. shell_control.platform_config WHERE key = 'google_doc_ai_credentials' (primary)
//   2. GOOGLE_DOC_AI_CREDENTIALS env var (fallback for local dev)
//
// GOOGLE_DOC_AI_CREDENTIALS is scoped to builds-only in Netlify (removed from Lambda
// env vars to stay under the 4KB limit). The credentials live in Supabase instead.
//
// Other env vars still needed:
//   GOOGLE_DOC_AI_ENDPOINT  — full processor endpoint URL (processDocument)
//   GOOGLE_DOC_AI_REGION    — "australia-southeast1" (reference only)
//
// Max file size: 10 MB. Accepted MIME types: PDF, JPG, PNG.

import { GoogleAuth } from 'google-auth-library'
import { withSentry } from './_shared/sentry.js'
import { getServiceClient } from './_shared/supabase.js'
import { verifySessionToken, readSessionCookie } from './_shared/token.js'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

// CORS — the only legitimate caller is the same-origin shell page
// (LicenceOcrPage fetches a relative URL), so genuine requests need no ACAO at
// all. We still emit a tight allow-list on the preflight instead of the previous
// `*`, so the endpoint can't be driven from an arbitrary origin. Mirrors cards-api.ts.
const ALLOWED_ORIGIN_EXACT = new Set<string>(['https://core.eq.solutions'])
const ALLOWED_ORIGIN_RE = /^https:\/\/deploy-preview-\d+--eq-shell\.netlify\.app$/

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  if (!ALLOWED_ORIGIN_EXACT.has(origin) && !ALLOWED_ORIGIN_RE.test(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

interface DocAiField {
  fieldName?: { textAnchor?: { content?: string }; confidence?: number }
  fieldValue?: { textAnchor?: { content?: string }; confidence?: number }
}

interface DocAiPage {
  formFields?: DocAiField[]
}

interface DocAiDocument {
  pages?: DocAiPage[]
  text?: string
}

interface DocAiResponse {
  document?: DocAiDocument
}

type FieldEntry = { value: string; confidence: number }

export default withSentry(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    // 204 must have a null body — `new Response('', { status: 204 })` throws in
    // the Node runtime (latent in the original; surfaced now we use OPTIONS).
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  // Auth gate — this endpoint runs paid Google Document AI under a service
  // account, so it must never be callable unauthenticated. Its only caller is
  // the signed-in operator page /:tenantSlug/onboarding/licence (LicenceOcrPage),
  // which sends the eq_shell_session cookie. Reject anyone without a valid session.
  const session = verifySessionToken(readSessionCookie(req))
  if (!session) return json(401, { error: 'Not signed in' })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const { file_base64, mime_type } = body

  if (typeof file_base64 !== 'string' || !file_base64) {
    return json(400, { error: 'file_base64 is required' })
  }
  if (typeof mime_type !== 'string' || !mime_type) {
    return json(400, { error: 'mime_type is required' })
  }
  if (!ALLOWED_TYPES.includes(mime_type)) {
    return json(415, { error: 'Unsupported file type. Use PDF, JPG, or PNG.' })
  }

  const fileBytes = Buffer.from(file_base64, 'base64')
  if (fileBytes.length > MAX_BYTES) {
    return json(413, { error: 'File too large. Maximum size is 10 MB.' })
  }

  // Authenticate with Google — credentials in Supabase platform_config (builds-only env var fallback).
  let credentialsRaw: string | undefined
  try {
    const sb = getServiceClient()
    const { data, error } = await sb
      .schema('shell_control')
      .from('platform_config')
      .select('value')
      .eq('key', 'google_doc_ai_credentials')
      .maybeSingle()
    if (!error && data?.value) {
      credentialsRaw = data.value as string
    }
  } catch {
    // Supabase unreachable — fall through to env var
  }
  if (!credentialsRaw) {
    credentialsRaw = process.env.GOOGLE_DOC_AI_CREDENTIALS
  }
  if (!credentialsRaw) {
    console.error('[ocr-parse] google_doc_ai_credentials not found in Supabase or env')
    return json(500, { error: 'OCR service not configured.' })
  }

  const endpoint = process.env.GOOGLE_DOC_AI_ENDPOINT
  if (!endpoint) {
    console.error('[ocr-parse] GOOGLE_DOC_AI_ENDPOINT not set')
    return json(500, { error: 'OCR service not configured.' })
  }

  let accessToken: string
  try {
    const credentials = JSON.parse(credentialsRaw) as Record<string, unknown>
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    if (!tokenResponse.token) throw new Error('Empty access token')
    accessToken = tokenResponse.token
  } catch (err) {
    console.error('[ocr-parse] Google auth failed:', err)
    return json(500, { error: 'OCR processing failed. Please try again.' })
  }

  // Call Document AI
  let docAiResult: DocAiResponse
  try {
    const docAiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rawDocument: {
          content: file_base64,
          mimeType: mime_type,
        },
      }),
    })

    if (!docAiResponse.ok) {
      const errText = await docAiResponse.text()
      throw new Error(`Document AI error ${docAiResponse.status}: ${errText}`)
    }

    docAiResult = (await docAiResponse.json()) as DocAiResponse
  } catch (err) {
    console.error('[ocr-parse] Document AI request failed:', err)
    return json(500, { error: 'OCR processing failed. Please try again.' })
  }

  // Extract form fields from Document AI Form Parser response
  // pages[].formFields[] has fieldName + fieldValue entities with textAnchor content
  const fields: Record<string, FieldEntry> = {}

  const pages = docAiResult.document?.pages ?? []
  for (const page of pages) {
    for (const field of page.formFields ?? []) {
      const rawName = (field.fieldName?.textAnchor?.content ?? '').trim()
      const name = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/g, '')
      const value = (field.fieldValue?.textAnchor?.content ?? '').trim()
      const confidence = field.fieldValue?.confidence ?? field.fieldName?.confidence ?? 0

      if (name && value && !(name in fields)) {
        fields[name] = { value, confidence }
      }
    }
  }

  // Map common Document AI field names to a normalised output schema
  const mapped: Record<string, string> = {}
  const confidences: Record<string, number> = {}

  function pick(...keys: string[]): FieldEntry | undefined {
    for (const k of keys) {
      if (fields[k]) return fields[k]
    }
    return undefined
  }

  const nameField = pick('name', 'full_name', 'given_name')
  if (nameField) { mapped.full_name = nameField.value; confidences.full_name = nameField.confidence }

  const licenceNumField = pick('licence_number', 'license_number', 'card_number', 'number')
  if (licenceNumField) { mapped.licence_number = licenceNumField.value; confidences.licence_number = licenceNumField.confidence }

  const expiryField = pick('expiry', 'expiry_date', 'expires', 'exp')
  if (expiryField) { mapped.expiry_date = expiryField.value; confidences.expiry_date = expiryField.confidence }

  const classField = pick('class', 'licence_class', 'license_class', 'vehicle_class')
  if (classField) { mapped.licence_class = classField.value; confidences.licence_class = classField.confidence }

  const dobField = pick('dob', 'date_of_birth', 'birth_date')
  if (dobField) { mapped.date_of_birth = dobField.value; confidences.date_of_birth = dobField.confidence }

  const authorityField = pick('issuing_authority', 'issued_by', 'authority', 'state')
  if (authorityField) { mapped.issuing_authority = authorityField.value; confidences.issuing_authority = authorityField.confidence }

  const rawText = docAiResult.document?.text ?? ''

  return json(200, {
    fields: mapped,
    confidence: confidences,
    raw_fields: fields,
    raw_text: rawText.slice(0, 2000),
  })
})
