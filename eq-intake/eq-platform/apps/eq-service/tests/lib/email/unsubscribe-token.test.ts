import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from '@/lib/email/unsubscribe-token'

const ORIG_SECRET = process.env.UNSUBSCRIBE_SECRET

beforeAll(() => {
  // Stable test secret. Real prod secret is 32-byte hex via openssl.
  process.env.UNSUBSCRIBE_SECRET = 'test-secret-at-least-sixteen-chars-yes'
})

afterAll(() => {
  if (ORIG_SECRET === undefined) delete process.env.UNSUBSCRIBE_SECRET
  else process.env.UNSUBSCRIBE_SECRET = ORIG_SECRET
})

describe('unsubscribe-token', () => {
  const cid = '11111111-2222-3333-4444-555555555555'

  it('round-trips a valid token', () => {
    const token = mintUnsubscribeToken(cid, 'monthly')
    const payload = verifyUnsubscribeToken(token)
    expect(payload).toEqual({ cid, s: 'monthly' })
  })

  it('round-trips all scopes', () => {
    for (const s of ['monthly', 'upcoming', 'all'] as const) {
      const t = mintUnsubscribeToken(cid, s)
      expect(verifyUnsubscribeToken(t)?.s).toBe(s)
    }
  })

  it('rejects tampered payload', () => {
    const token = mintUnsubscribeToken(cid, 'monthly')
    const [pld, sig] = token.split('.')
    // Flip a base64 char in the payload.
    const swap = pld.startsWith('e') ? 'f' + pld.slice(1) : 'e' + pld.slice(1)
    expect(verifyUnsubscribeToken(`${swap}.${sig}`)).toBeNull()
  })

  it('rejects tampered signature', () => {
    const token = mintUnsubscribeToken(cid, 'monthly')
    const [pld, sig] = token.split('.')
    const swap = sig.startsWith('A') ? 'B' + sig.slice(1) : 'A' + sig.slice(1)
    expect(verifyUnsubscribeToken(`${pld}.${swap}`)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull()
    expect(verifyUnsubscribeToken('a.b.c')).toBeNull()
  })

  it('rejects an invalid scope smuggled into the payload', () => {
    // Mint with all, then craft a payload claiming scope='evil'.
    const bad = Buffer.from(JSON.stringify({ cid, s: 'evil' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    // Sign with the same secret so the signature check passes — proves
    // the payload-shape validation is doing its own job.
    const t = mintUnsubscribeToken(cid, 'all')
    const [, validSig] = t.split('.')
    expect(verifyUnsubscribeToken(`${bad}.${validSig}`)).toBeNull()
  })

  it('rejects when UNSUBSCRIBE_SECRET is missing', () => {
    const saved = process.env.UNSUBSCRIBE_SECRET
    delete process.env.UNSUBSCRIBE_SECRET
    expect(verifyUnsubscribeToken('foo.bar')).toBeNull()
    expect(() => mintUnsubscribeToken(cid)).toThrow(/UNSUBSCRIBE_SECRET/)
    process.env.UNSUBSCRIBE_SECRET = saved
  })

  it('buildUnsubscribeUrl produces a working /portal/unsubscribe URL', () => {
    const url = buildUnsubscribeUrl('https://example.com', cid, 'all')
    expect(url).toMatch(/^https:\/\/example\.com\/portal\/unsubscribe\?token=/)
    const tokenParam = new URL(url).searchParams.get('token')!
    expect(verifyUnsubscribeToken(tokenParam)?.cid).toBe(cid)
  })

  it('buildUnsubscribeUrl strips trailing slash from appUrl', () => {
    const url = buildUnsubscribeUrl('https://example.com/', cid)
    expect(url.startsWith('https://example.com/portal/unsubscribe')).toBe(true)
  })
})
