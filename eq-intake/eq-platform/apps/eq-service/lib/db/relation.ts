/**
 * Helpers for unwrapping Supabase relationship joins.
 *
 * Supabase's PostgREST query builder types every nested-select join as
 * `T | T[] | null` because it can't statically know whether a foreign key
 * is to-one or to-many. A query like:
 *
 *     supabase.from('sites').select('id, name, customers(name)')
 *
 * gives back rows where `customers` could be `{ name: string } | { name: string }[] | null`.
 * In practice each site has at most one customer, so the runtime value
 * is always a single object or null — but TypeScript still sees the array
 * variant as legal.
 *
 * Without these helpers, call sites paper over the union with one of:
 *   - `(row.customers as unknown as { name: string } | null)?.name`
 *     (silently lies — masks any real schema mismatch with `as unknown`)
 *   - `Array.isArray(row.customers) ? row.customers[0]?.name : row.customers?.name`
 *     (correct but verbose, easy to miss the array branch)
 *
 * Use `firstRow()` instead. Single, named, type-safe.
 *
 * Example:
 *
 *     const customer = firstRow(site.customers)
 *     const customerName = customer?.name ?? null
 *
 *     const assetName = firstRow(test.assets)?.name ?? '—'
 */

/**
 * Unwrap a Supabase to-one relationship from `T | T[] | null | undefined`
 * to `T | null`. If the value is an array, returns the first element.
 * If null/undefined/empty, returns null.
 */
export function firstRow<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}
