'use server'

import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { geocodeAddress } from '@/lib/utils/geocode'

const schema = z.object({
  address: z.string().min(1, 'Address is required to geocode.'),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
})

/**
 * Geocode-only action: returns coordinates without writing them. The form
 * shows the result so the user can eyeball it and then save via the normal
 * "Update Site" flow. Keeps the geocode roundtrip out of the form's submit
 * critical path so a slow Nominatim doesn't block save.
 */
export async function geocodeSiteAddressAction(formData: FormData) {
  const parsed = schema.safeParse({
    address: formData.get('address'),
    city: formData.get('city'),
    state: formData.get('state'),
    postcode: formData.get('postcode'),
    country: formData.get('country'),
  })
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { role } = await requireUser()
  if (!canWrite(role)) {
    return { ok: false as const, error: 'Not authorised.' }
  }

  return geocodeAddress(parsed.data)
}
