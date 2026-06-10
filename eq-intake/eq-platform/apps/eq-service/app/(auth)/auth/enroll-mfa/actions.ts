'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

function generateRecoveryCode(): string {
  // 10-character base32-like uppercase code, formatted XXXXX-XXXXX
  const raw = randomBytes(8).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10).padEnd(10, 'A')
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
}

export async function enrollStartAction() {
  const supabase = await createClient()

  // Clean up any stale unverified factors from a previous aborted enrolment.
  const { data: existing } = await supabase.auth.mfa.listFactors()
  for (const f of existing?.all ?? []) {
    if (f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `EQ Solves ${new Date().toISOString()}`,
  })
  if (error) return { error: error.message }
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code, // SVG string
    secret: data.totp.secret,
  }
}

export async function enrollVerifyAction(formData: FormData) {
  const factorId = String(formData.get('factorId') || '')
  const code = String(formData.get('code') || '').trim()
  if (!factorId || !code) return { error: 'Missing factor or code.' }

  const supabase = await createClient()

  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error) return { error: challenge.error.message }

  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  })
  if (verify.error) return { error: verify.error.message }

  // Generate 8 one-time recovery codes, hash and store.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expired.' }

  const codes = Array.from({ length: 8 }, generateRecoveryCode)
  const rows = await Promise.all(
    codes.map(async (c) => ({
      user_id: user.id,
      code_hash: await bcrypt.hash(c, 10),
    }))
  )
  const admin = createAdminClient()
  const { error: insertErr } = await admin.from('mfa_recovery_codes').insert(rows)
  if (insertErr) return { error: `Could not store recovery codes: ${insertErr.message}` }

  return { ok: true, codes }
}
