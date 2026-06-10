import type { ZodIssue } from 'zod'

/**
 * Map Zod issues to a field-name-keyed error record.
 *
 * Used by the validation-surface refactor (PR H — UX audit §2.11 / §3.5).
 * Previously server actions returned `{ success: false, error: 'msg' }`
 * — only the first issue, rendered as a single red line at the bottom of
 * the slide panel. The admin had to scroll, guess which field, fix,
 * resubmit. On long SiteForm-style panels this was brutal on touch.
 *
 * With this helper, server actions return BOTH:
 *   - `error: '<first issue summary>'`  (kept for legacy callers + banner)
 *   - `errors: { field1: 'msg', field2: 'msg' }`
 *
 * Forms then thread `errors[fieldName]` into each `<FormInput error={...} />`.
 *
 * Path resolution: uses `issue.path[0]` as the key. Nested paths
 * (`['address', 'street']`) collapse to the top-level field — fine for
 * the current schemas, which are mostly flat. Revisit if nested objects
 * land.
 *
 * Returns an empty object for issues with no path (e.g. cross-field
 * refinement failures). The caller can still surface those via the
 * top-level `error` banner.
 */
export function zodToErrorMap(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in out)) {
      out[key] = issue.message
    }
  }
  return out
}
