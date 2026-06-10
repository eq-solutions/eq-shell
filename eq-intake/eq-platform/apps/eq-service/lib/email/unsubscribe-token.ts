/**
 * unsubscribe-token.ts
 *
 * HMAC-signed token helper for customer-facing unsubscribe links.
 *
 * Signed because the alternative — putting a raw `customer_contact_id`
 * UUID in the URL — lets anyone who guesses or scrapes a UUID unsub
 * another customer. Signing with a server-side secret means only
 * tokens minted by us are valid.
 *
 * Format: `<base64url(payload)>.<base64url(signature)>`
 *   payload   = JSON `{ cid: <customer_contact_id>, s: <scope> }`
 *   signature = HMAC-SHA256(payload, UNSUBSCRIBE_SECRET)
 *
 * Tokens don't expire. The customer can keep an email forever and the
 * link still works — that's the right UX for an unsubscribe link.
 * (If we ever need revocation, rotate UNSUBSCRIBE_SECRET; every prior
 * link is invalidated immediately.)
 *
 * AU Spam Act 2003 s18 compliance hook:
 *   - functional (one click)
 *   - no fee / no auth required
 *   - processed at request time (we flip the prefs synchronously)
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export type UnsubscribeScope = 'monthly' | 'upcoming' | 'all'

interface TokenPayload {
  cid: string  // customer_contact_id
  s: UnsubscribeScope
}

function getSecret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET
  if (!s || s.length < 16) {
    throw new Error('UNSUBSCRIBE_SECRET is not configured (need >= 16 chars)')
  }
  return s
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Mint an unsubscribe token for a customer contact + scope.
 * Throws if UNSUBSCRIBE_SECRET is missing — callers should catch and
 * fall back to omitting the unsub link rather than failing the email.
 */
export function mintUnsubscribeToken(customerContactId: string, scope: UnsubscribeScope = 'all'): string {
  const secret = getSecret()
  const payload: TokenPayload = { cid: customerContactId, s: scope }
  const payloadStr = JSON.stringify(payload)
  const payloadEncoded = base64UrlEncode(Buffer.from(payloadStr, 'utf8'))
  const signature = sign(payloadEncoded, secret)
  return `${payloadEncoded}.${signature}`
}

/**
 * Verify a token. Returns the payload if valid, null otherwise.
 * Uses timingSafeEqual so signature comparisons can't leak via timing.
 */
export function verifyUnsubscribeToken(token: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadEncoded, signature] = parts

  let secret: string
  try { secret = getSecret() } catch { return null }

  const expectedSig = sign(payloadEncoded, secret)
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(signature)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  try {
    const decoded = base64UrlDecode(payloadEncoded).toString('utf8')
    const parsed = JSON.parse(decoded) as TokenPayload
    if (typeof parsed?.cid !== 'string') return null
    if (parsed.s !== 'monthly' && parsed.s !== 'upcoming' && parsed.s !== 'all') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Build the full /portal/unsubscribe URL with the token query param.
 * Helper kept in this module so the email senders can call it without
 * re-implementing the URL shape.
 */
export function buildUnsubscribeUrl(appUrl: string, customerContactId: string, scope: UnsubscribeScope = 'all'): string {
  const token = mintUnsubscribeToken(customerContactId, scope)
  const base = appUrl.replace(/\/$/, '')
  return `${base}/portal/unsubscribe?token=${encodeURIComponent(token)}`
}
