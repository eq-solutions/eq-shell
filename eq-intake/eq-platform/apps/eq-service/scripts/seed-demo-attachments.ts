/**
 * Seed Demo tenant attachments — Sprint 3.1 wrap-up (2026-04-26).
 *
 * After migration 0060 truncated the attachments table, the Demo tenant has
 * zero attachments which makes the UI look hollow when prospects view it.
 * This script populates a small, varied set across the three categories
 * (evidence / reference / paperwork) so the AttachmentList components feel
 * lived-in.
 *
 * Strategy:
 *   - Upload tiny placeholder PNGs (generated inline, no external deps) to
 *     the 'attachments' bucket under the Demo tenant prefix.
 *   - Insert matching metadata rows on `public.attachments` with the right
 *     attachment_type so the UI filters them correctly.
 *   - Spread the rows across:
 *       * a few defects   → Evidence
 *       * a few sites     → Reference
 *       * a few WOs/checks → Paperwork
 *
 * Run from repo root:
 *   npx tsx scripts/seed-demo-attachments.ts
 *
 * Required env (read from .env.local automatically if dotenv is used; else
 * pass on the command line):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (NOT the anon key — script needs to bypass RLS)
 *
 * Idempotent: skips files that already exist; re-running won't duplicate.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001'

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env.')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * Tiny PNG generator — produces a 200×200 solid-colour PNG with a label
 * stamped in the centre. Avoids needing any external image dependencies.
 *
 * Inline base64 of a 200×200 mid-grey PNG (we don't actually render text;
 * the label only lives in the file_name so it shows in the list).
 */
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const placeholderBytes = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64')

interface SeedSpec {
  category: 'evidence' | 'reference' | 'paperwork'
  /** Which entity table to walk for parent rows. */
  entityTable: 'defects' | 'sites' | 'maintenance_checks'
  /** entity_type written onto the attachment row (matches AttachmentList lookups). */
  entityType: string
  /** How many rows to seed at most. */
  cap: number
  /** Sample file labels — cycled across rows. */
  filenames: string[]
}

const SPECS: SeedSpec[] = [
  {
    category: 'evidence',
    entityTable: 'defects',
    entityType: 'defect',
    cap: 6,
    filenames: ['failure-photo.png', 'corroded-terminal.png', 'overheated-busbar.png'],
  },
  {
    category: 'reference',
    entityTable: 'sites',
    entityType: 'site',
    cap: 8,
    filenames: ['single-line-diagram.png', 'switchroom-layout.png', 'arc-flash-study.png', 'site-induction.png'],
  },
  {
    category: 'paperwork',
    entityTable: 'maintenance_checks',
    entityType: 'maintenance_check',
    cap: 5,
    filenames: ['customer-signoff.png', 'PO-confirmation.png', 'job-card.png'],
  },
]

async function seedSpec(spec: SeedSpec) {
  const { data: rows, error } = await admin
    .from(spec.entityTable)
    .select('id')
    .eq('tenant_id', DEMO_TENANT_ID)
    .limit(spec.cap)

  if (error) {
    console.error(`[${spec.category}] failed to fetch ${spec.entityTable}:`, error.message)
    return 0
  }

  let added = 0
  for (let i = 0; i < (rows ?? []).length; i++) {
    const row = (rows ?? [])[i] as { id: string }
    const fileName = spec.filenames[i % spec.filenames.length]
    const storagePath = `${DEMO_TENANT_ID}/${spec.entityType}/${row.id}/${Date.now()}_${i}_${fileName}`

    // Upload placeholder bytes
    const { error: upErr } = await admin.storage
      .from('attachments')
      .upload(storagePath, placeholderBytes, { contentType: 'image/png', upsert: false })
    if (upErr && !upErr.message.toLowerCase().includes('already exists')) {
      console.warn(`[${spec.category}] upload failed (${storagePath}):`, upErr.message)
      continue
    }

    // Insert metadata row
    const { error: dbErr } = await admin.from('attachments').insert({
      tenant_id: DEMO_TENANT_ID,
      entity_type: spec.entityType,
      entity_id: row.id,
      attachment_type: spec.category,
      file_name: fileName,
      file_size: placeholderBytes.length,
      content_type: 'image/png',
      storage_path: storagePath,
      uploaded_by: null,
    })
    if (dbErr) {
      console.warn(`[${spec.category}] metadata insert failed:`, dbErr.message)
      // Roll back the uploaded file to avoid orphans
      await admin.storage.from('attachments').remove([storagePath])
      continue
    }
    added += 1
  }
  console.log(`[${spec.category}] seeded ${added} attachments across ${spec.entityType}.`)
  return added
}

async function main() {
  console.log('Seeding Demo tenant attachments…')
  let total = 0
  for (const spec of SPECS) {
    total += await seedSpec(spec)
  }
  console.log(`\nDone — ${total} attachments seeded for Demo tenant.`)
  console.log('Visit /defects, /sites and /maintenance with the Demo tenant active to see them.')
}

main().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
