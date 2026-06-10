/**
 * Server-side geocoder using OpenStreetMap Nominatim.
 *
 * NOT marked 'use server'. This is a helper imported by server actions.
 * Per the auth.ts convention: avoid 'use server' on shared helpers so we
 * don't accidentally expose every export as a public RPC endpoint.
 *
 * Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - max 1 request per second
 *   - real User-Agent identifying the application
 *   - cache results, no bulk geocoding
 *   - heavy use should self-host a Nominatim instance
 *
 * Our use case is one-off lookups when an admin clicks "Geocode address" on
 * the Site form, so we sit well inside the policy. If we ever automate this
 * (auto-geocode on insert) we'd want to add per-tenant rate limiting first.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'EQ-Solves-Service/1.0 (admin@eq.solutions)'

export type GeocodeResult =
  | { ok: true; latitude: number; longitude: number; displayName: string }
  | { ok: false; error: string }

export async function geocodeAddress(opts: {
  address: string
  city?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
}): Promise<GeocodeResult> {
  const parts = [opts.address, opts.city, opts.state, opts.postcode, opts.country ?? 'Australia']
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())

  if (parts.length === 0) return { ok: false, error: 'No address provided.' }

  const query = parts.join(', ')
  const url = `${NOMINATIM_URL}?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(query)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Geocode request failed.' }
  }

  if (!res.ok) {
    return { ok: false, error: `Geocoder returned HTTP ${res.status}.` }
  }

  let data: Array<{ lat: string; lon: string; display_name: string }>
  try {
    data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  } catch {
    return { ok: false, error: 'Geocoder returned malformed JSON.' }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: `No results for "${query}".` }
  }

  const lat = parseFloat(data[0].lat)
  const lng = parseFloat(data[0].lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: 'Geocoder returned invalid coordinates.' }
  }

  return { ok: true, latitude: lat, longitude: lng, displayName: data[0].display_name }
}
