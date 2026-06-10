'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import type { AttachmentType } from '@/lib/types'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
]

const VALID_ATTACHMENT_TYPES: readonly AttachmentType[] = ['evidence', 'reference', 'paperwork'] as const

/**
 * Sensible default category given the parent entity. The form still asks the
 * user, but the picker pre-selects this so they only have to deviate when
 * needed. Reduces clicks for the most common pattern (defect → evidence).
 */
function inferAttachmentType(entityType: string): AttachmentType {
  if (entityType === 'site' || entityType === 'asset') return 'reference'
  if (entityType === 'work_order' || entityType.startsWith('wo_')) return 'paperwork'
  // defects, maintenance_check, *_test → evidence
  return 'evidence'
}

export async function uploadAttachmentAction(
  entityType: string,
  entityId: string,
  formData: FormData
) {
  try {
    const { supabase, user, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const file = formData.get('file') as File | null
    if (!file || file.size === 0) return { success: false, error: 'No file provided.' }
    if (file.size > MAX_FILE_SIZE) return { success: false, error: 'File exceeds 10 MB limit.' }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { success: false, error: `File type "${file.type}" not allowed. Accepted: PDF, images, XLSX, DOCX, CSV, TXT.` }
    }

    // Type comes from the form (radio in the upload modal). Falls back to a
    // context-aware default so older callers without the picker still work.
    const requestedType = String(formData.get('attachment_type') ?? '').trim() as AttachmentType
    const attachmentType: AttachmentType = VALID_ATTACHMENT_TYPES.includes(requestedType)
      ? requestedType
      : inferAttachmentType(entityType)

    // Build storage path: {tenant_id}/{entity_type}/{entity_id}/{timestamp}_{filename}
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${tenantId}/${entityType}/${entityId}/${Date.now()}_${safeName}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(storagePath, file, { contentType: file.type, upsert: false })

    if (uploadError) return { success: false, error: uploadError.message }

    // Insert metadata row
    const { error: dbError } = await supabase.from('attachments').insert({
      tenant_id: tenantId,
      entity_type: entityType,
      entity_id: entityId,
      attachment_type: attachmentType,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type,
      storage_path: storagePath,
      uploaded_by: user.id,
    })

    if (dbError) {
      // Cleanup storage on DB failure
      await supabase.storage.from('attachments').remove([storagePath])
      return { success: false, error: dbError.message }
    }

    revalidatePath(`/${entityType.replace('_', '-')}s`)
    return { success: true, attachmentType }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteAttachmentAction(attachmentId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    // Get attachment to find storage path
    const { data: attachment } = await supabase
      .from('attachments')
      .select('storage_path, entity_type')
      .eq('id', attachmentId)
      .maybeSingle()

    if (!attachment) return { success: false, error: 'Attachment not found.' }

    // Delete from storage
    await supabase.storage.from('attachments').remove([attachment.storage_path])

    // Delete metadata row
    const { error } = await supabase.from('attachments').delete().eq('id', attachmentId)
    if (error) return { success: false, error: error.message }

    revalidatePath(`/${attachment.entity_type.replace('_', '-')}s`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getAttachmentUrlAction(storagePath: string) {
  try {
    const { supabase } = await requireUser()
    const { data } = await supabase.storage
      .from('attachments')
      .createSignedUrl(storagePath, 3600) // 1 hour

    if (!data?.signedUrl) return { success: false, error: 'Could not generate URL.' }
    return { success: true, url: data.signedUrl }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
