// nspbmir → ehow identity bridge resolver (pure, DB-agnostic).
//
// The bridge is pre-built: every nspbmir public.people row carries a
// `canonical_id` that equals the ehow app_data.staff `staff_id` it was synced
// to (ehow staff.external_id also mirrors the legacy person id, as a string).
//
// This module turns a flat array of ehow staff rows into a resolver that maps a
// legacy person reference → staff_id. nspbmir leave_requests reference people by
// NAME (requester_name / approver_name), and team_members reference them by
// person_id (bigint). So the resolver supports both lookups:
//
//   - byExternalId(person_id)  — exact, preferred; person_id stringified ===
//                                staff.external_id
//   - byName(full_name)        — fallback for leave (name-keyed source); case- and
//                                whitespace-insensitive. Ambiguous names (two staff
//                                sharing a normalized name) resolve to `null` and
//                                are reported, never guessed.
//
// No Supabase driver is imported here — the runner reads the staff rows and
// passes them in. That keeps the resolver unit-testable against fixtures and
// lets the transforms stay pure.

export interface StaffRow {
  staff_id: string;            // ehow app_data.staff PK (uuid)
  external_id: string | null;  // mirrors legacy nspbmir person id (stringified bigint)
  name: string | null;         // canonical display name
}

export interface ResolveResult {
  staff_id: string | null;
  via: 'external_id' | 'name' | 'unmatched' | 'ambiguous';
}

export interface IdentityResolver {
  // person_id is the legacy nspbmir people.id (bigint, arrives as number|string|bigint)
  byExternalId(personId: number | string | bigint | null | undefined): ResolveResult;
  byName(fullName: string | null | undefined): ResolveResult;
  // Diagnostics for the dry-run report.
  stats(): { staffCount: number; ambiguousNames: string[] };
}

function normName(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Build a resolver from ehow staff rows. Pure — no I/O.
 *
 * Names that map to more than one staff_id are recorded as ambiguous and will
 * resolve to `null` (via: 'ambiguous') rather than silently picking one.
 */
export function buildResolver(staff: StaffRow[]): IdentityResolver {
  const byExt = new Map<string, string>();
  const byNameMap = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const s of staff) {
    if (s.external_id != null && s.external_id !== '') {
      byExt.set(String(s.external_id), s.staff_id);
    }
    const n = normName(s.name);
    if (n) {
      if (byNameMap.has(n) && byNameMap.get(n) !== s.staff_id) {
        ambiguous.add(n);
      } else {
        byNameMap.set(n, s.staff_id);
      }
    }
  }
  // Drop ambiguous names from the positive map so byName can't return a stale
  // first-wins value.
  for (const n of ambiguous) byNameMap.delete(n);

  return {
    byExternalId(personId) {
      if (personId == null || personId === '') return { staff_id: null, via: 'unmatched' };
      const hit = byExt.get(String(personId));
      return hit
        ? { staff_id: hit, via: 'external_id' }
        : { staff_id: null, via: 'unmatched' };
    },
    byName(fullName) {
      const n = normName(fullName);
      if (!n) return { staff_id: null, via: 'unmatched' };
      if (ambiguous.has(n)) return { staff_id: null, via: 'ambiguous' };
      const hit = byNameMap.get(n);
      return hit
        ? { staff_id: hit, via: 'name' }
        : { staff_id: null, via: 'unmatched' };
    },
    stats() {
      return { staffCount: staff.length, ambiguousNames: [...ambiguous].sort() };
    },
  };
}
