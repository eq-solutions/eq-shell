// Pure transforms: nspbmir public.teams / team_members → ehow app_data.teams /
// team_members. No DB driver, no I/O — each function takes one source row (+ an
// injected identity resolver where staff resolution is needed) and returns the
// normalized target row plus per-row diagnostics for the dry-run report.
//
// Source (nspbmir, WIDE):
//   public.teams        { id bigint, org_id uuid, name text, color text }
//   public.team_members { team_id bigint, person_id bigint, org_id uuid }
//
// Target (ehow, NORMALIZED app_data):
//   teams        { id uuid, tenant_id uuid, nspbmir_id bigint, name, color }
//   team_members { id uuid, team_id uuid, staff_id uuid, tenant_id uuid }
//
// Mapping rules:
//   - teams.id (bigint)        → teams.nspbmir_id          (provenance key)
//   - teams.id                 → resolved to a target team uuid by the runner
//                                (deterministic, via makeTeamUuid) so members can
//                                point at it without a DB round-trip.
//   - team_members.person_id   → staff_id via the identity resolver (byExternalId)
//
// The target `id` uuids are deterministic (UUIDv5-style namespaced on tenant +
// nspbmir id) so a dry-run and a later apply agree, and re-runs are idempotent.

import { createHash } from 'node:crypto';
import type { IdentityResolver } from './identity-bridge.ts';

export interface SourceTeam {
  id: number | string;          // bigint
  org_id: string;
  name: string | null;
  color: string | null;
}

export interface SourceTeamMember {
  team_id: number | string;     // bigint, FK → teams.id
  person_id: number | string;   // bigint, FK → people.id
  org_id: string;
}

export interface TargetTeam {
  id: string;                   // uuid (deterministic)
  tenant_id: string;
  nspbmir_id: number;           // provenance: legacy bigint id
  name: string | null;
  color: string | null;
}

export interface TargetTeamMember {
  id: string;                   // uuid (deterministic)
  team_id: string;              // uuid → teams.id
  staff_id: string;             // uuid → staff.staff_id
  tenant_id: string;
}

export interface TeamResult {
  ok: true;
  row: TargetTeam;
}

export interface TeamMemberResult {
  ok: boolean;
  row: TargetTeamMember | null;
  // Diagnostics for the dry-run report.
  issues: string[];             // e.g. 'unmatched_person', 'orphan_team'
  source: { team_id: string; person_id: string };
}

// Deterministic uuid from a namespace string. Not a true RFC-4122 v5 (no
// registered namespace) but stable and collision-safe for our keys: same input
// → same uuid, every run. Formatted as a v4-shaped uuid so Postgres accepts it.
export function makeUuid(...parts: Array<string | number>): string {
  const h = createHash('sha256').update(parts.join('::')).digest('hex');
  // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return (
    h.slice(0, 8) + '-' +
    h.slice(8, 12) + '-4' +
    h.slice(13, 16) + '-' +
    ((parseInt(h.slice(16, 17), 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 20) + '-' +
    h.slice(20, 32)
  );
}

export function makeTeamUuid(tenantId: string, nspbmirId: number | string): string {
  return makeUuid('team', tenantId, String(nspbmirId));
}

export function transformTeam(src: SourceTeam, tenantId: string): TeamResult {
  const nspbmirId = Number(src.id);
  return {
    ok: true,
    row: {
      id: makeTeamUuid(tenantId, nspbmirId),
      tenant_id: tenantId,
      nspbmir_id: nspbmirId,
      name: src.name ?? null,
      color: src.color ?? null,
    },
  };
}

/**
 * Transform a team_member. Needs:
 *   - the identity resolver to map person_id → staff_id
 *   - the set of valid source team ids (to flag members whose team didn't
 *     transform — an orphan risk surfaced in the report, not silently dropped)
 */
export function transformTeamMember(
  src: SourceTeamMember,
  tenantId: string,
  resolver: IdentityResolver,
  validTeamIds: ReadonlySet<string>,
): TeamMemberResult {
  const issues: string[] = [];
  const sourceTeamId = String(src.team_id);
  const sourcePersonId = String(src.person_id);

  const teamExists = validTeamIds.has(sourceTeamId);
  if (!teamExists) issues.push('orphan_team');

  const resolved = resolver.byExternalId(src.person_id);
  if (!resolved.staff_id) issues.push('unmatched_person');

  if (!teamExists || !resolved.staff_id) {
    return { ok: false, row: null, issues, source: { team_id: sourceTeamId, person_id: sourcePersonId } };
  }

  return {
    ok: true,
    row: {
      id: makeUuid('team_member', tenantId, sourceTeamId, sourcePersonId),
      team_id: makeTeamUuid(tenantId, sourceTeamId),
      staff_id: resolved.staff_id,
      tenant_id: tenantId,
    },
    issues,
    source: { team_id: sourceTeamId, person_id: sourcePersonId },
  };
}
