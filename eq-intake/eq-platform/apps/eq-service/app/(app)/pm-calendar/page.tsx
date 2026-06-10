import { redirect } from 'next/navigation'

// Legacy route — PM Calendar was renamed to Calendar. Preserve any search params.
export default async function PmCalendarRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x))
  }
  const suffix = qs.toString()
  redirect(`/calendar${suffix ? `?${suffix}` : ''}`)
}
