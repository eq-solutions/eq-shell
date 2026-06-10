/**
 * Damerau-free Levenshtein edit distance — number of single-character
 * insertions, deletions, or substitutions to turn `a` into `b`.
 *
 * Pure function, allocation-light, used by the Delta WO importer to
 * suggest job-plan code corrections (e.g. `MVSWBD` → `MVSWDB`, distance 1).
 *
 * Comparison is case-insensitive. Empty strings behave the usual way:
 * distance(`''`, x) === x.length.
 */
export function levenshtein(a: string, b: string): number {
  const s = (a ?? '').toUpperCase()
  const t = (b ?? '').toUpperCase()

  if (s === t) return 0
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length

  // Two-row DP: prev = row for s[0..i-1], curr = row for s[0..i].
  const n = t.length
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)

  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    const si = s.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = si === t.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1, // insert
        prev[j] + 1, // delete
        prev[j - 1] + cost, // substitute
      )
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return prev[n]
}

/**
 * Find the closest candidate from a list by Levenshtein distance. Returns
 * the best match only if its distance is within `maxDistance`. Ties broken
 * by the first candidate in input order.
 */
export function closestMatch(
  needle: string,
  haystack: string[],
  maxDistance = 2,
): { value: string; distance: number } | null {
  let best: { value: string; distance: number } | null = null
  for (const candidate of haystack) {
    const d = levenshtein(needle, candidate)
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { value: candidate, distance: d }
      if (d === 0) return best
    }
  }
  return best
}
