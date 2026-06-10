'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import type { MediaCategory } from '@/lib/types'

const MEDIA_MAX_SIZE = 2 * 1024 * 1024 // 2 MB
const MEDIA_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const ALLOWED_CATEGORIES: MediaCategory[] = ['customer_logo', 'site_photo', 'report_image', 'general']

function parseCategories(formData: FormData): MediaCategory[] {
  // Multi-select arrives as either repeated formData entries ("categories")
  // or a single comma-separated string. Accept both, validate, dedupe.
  const raw = formData.getAll('categories') as string[]
  let candidates: string[]
  if (raw.length > 1 || (raw.length === 1 && !raw[0].includes(','))) {
    candidates = raw
  } else if (raw.length === 1) {
    candidates = raw[0].split(',').map((s) => s.trim()).filter(Boolean)
  } else {
    // Legacy single-value fallback so any caller still posting "category" keeps working.
    const legacy = (formData.get('category') as string) ?? 'general'
    candidates = [legacy]
  }
  const valid = candidates.filter((c): c is MediaCategory =>
    ALLOWED_CATEGORIES.includes(c as MediaCategory),
  )
  // Dedupe while preserving order — first wins, becomes categories[0]/legacy.
  const seen = new Set<string>()
  const deduped: MediaCategory[] = []
  for (const c of valid) {
    if (!seen.has(c)) {
      seen.add(c)
      deduped.push(c)
    }
  }
  return deduped.length > 0 ? deduped : ['general']
}

export async function uploadMediaAction(formData: FormData) {
  try {
    const { supabase, user, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const file = formData.get('file') as File | null
    const name = (formData.get('name') as string)?.trim()
    const categories = parseCategories(formData)
    const entityType = (formData.get('entity_type') as string) || null
    const entityId = (formData.get('entity_id') as string) || null
    const surfaceRaw = (formData.get('surface') as string) || 'any'
    const surface = ['light', 'dark', 'any'].includes(surfaceRaw) ? surfaceRaw : 'any'

    if (!file || file.size === 0) return { success: false, error: 'No file provided.' }
    if (!name) return { success: false, error: 'Name is required.' }
    if (file.size > MEDIA_MAX_SIZE) return { success: false, error: 'File exceeds 2 MB limit.' }
    if (!MEDIA_ALLOWED_TYPES.includes(file.type)) {
      return { success: false, error: 'File type not allowed. Use PNG, JPG, SVG, or WebP.' }
    }

    // Build storage path — use the primary (first) category in the path so it's grouped sensibly.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${tenantId}/media/${categories[0]}/${Date.now()}_${safeName}`

    // Upload to logos bucket (public)
    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(storagePath, file, { contentType: file.type, upsert: false })

    if (uploadError) return { success: false, error: uploadError.message }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('logos')
      .getPublicUrl(storagePath)

    const fileUrl = urlData?.publicUrl
    if (!fileUrl) return { success: false, error: 'Failed to get public URL.' }

    // Insert media record. The DB trigger sync_media_library_category() mirrors
    // categories[0] into the legacy `category` column, so we don't need to set
    // both columns explicitly — but doing so keeps things explicit on insert.
    const { error: insertError } = await supabase
      .from('media_library')
      .insert({
        tenant_id: tenantId,
        name,
        categories,
        category: categories[0],
        entity_type: entityType,
        entity_id: entityId,
        file_url: fileUrl,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        surface,
        uploaded_by: user.id,
      })

    if (insertError) return { success: false, error: insertError.message }

    await logAuditEvent({
      action: 'create',
      entityType: 'media',
      summary: `Uploaded media "${name}" (${categories.join(', ')})`,
    })
    revalidatePath('/admin/media')
    return { success: true, fileUrl }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateMediaAction(
  id: string,
  data: {
    name?: string
    /** Multi-category — preferred. */
    categories?: MediaCategory[]
    /** Legacy single-value — kept for callers not yet updated. */
    category?: MediaCategory
    entity_type?: string | null
    entity_id?: string | null
    surface?: 'light' | 'dark' | 'any'
  },
) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const update: Record<string, unknown> = {}
    if (typeof data.name === 'string') update.name = data.name
    if (data.entity_type !== undefined) update.entity_type = data.entity_type
    if (data.entity_id !== undefined) update.entity_id = data.entity_id
    if (data.surface !== undefined) update.surface = data.surface

    // Resolve the categories list — prefer the array, fall back to single value.
    let categories: MediaCategory[] | null = null
    if (data.categories && data.categories.length > 0) {
      categories = data.categories.filter((c) => ALLOWED_CATEGORIES.includes(c))
    } else if (data.category) {
      categories = [data.category]
    }
    if (categories && categories.length > 0) {
      // Dedupe preserving order
      const seen = new Set<string>()
      const deduped: MediaCategory[] = []
      for (const c of categories) {
        if (!seen.has(c)) {
          seen.add(c)
          deduped.push(c)
        }
      }
      update.categories = deduped
      // Mirror primary into legacy column explicitly (trigger does this too,
      // but explicit is clearer in audit).
      update.category = deduped[0]
    }

    const { error } = await supabase
      .from('media_library')
      .update(update)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'media',
      entityId: id,
      summary: `Updated media item${categories ? ` (categories: ${categories.join(', ')})` : ''}`,
    })
    revalidatePath('/admin/media')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteMediaAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    // Soft delete
    const { error } = await supabase
      .from('media_library')
      .update({ is_active: false })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'delete',
      entityType: 'media',
      entityId: id,
      summary: 'Soft-deleted media item',
    })
    revalidatePath('/admin/media')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
