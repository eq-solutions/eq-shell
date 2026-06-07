// Pure transform: nspbmir public.leave_requests → ehow app_data.leave_requests.
// No DB driver, no I/O. Takes one source row + an injected identity resolver,
// returns the normalized target row plus per-row diagnostics for the dry-run
// report.
//
// Source (nspbmir, WIDE):
//   public.leave_requests {
//     id, requester_name text, leave_type text, date_start text, date_end text,
//     note text, approver_name text, individual_days jsonb, status text,
//     archived bool, ...
//   }
//
// Target (ehow, NORMALIZED app_data.leave_requests) — shape from
// @eq/schemas leave-request.types.ts:
//   { leave_request_id uuid, tenant_id, staff_id, leave_type (enum), from_date,
//     to_date (date), hours_requested numeric?, status (enum), reason?,
//     approver_id?, decided_at?, decision_notes?, archived?, imported_at?,
//     imported_from? }
//
// Mapping:
//   requester_name → staff_id   (via resolver.byName — source is name-keyed)
//   date_start     → from_date  (text → ISO date)
//   date_end       → to_date
//   note           → reason
//   approver_name  → approver_id (via resolver.byName; optional — null if absent/unmatched)
//   leave_type     → leave_type  (mapped onto the closed enum; A/L→annual,
//                                  U/L→unpaid; RDO has no leave_requests enum →
//                                  'other' + verbatim "[leave_type: RDO]" carrier
//                                  prefixed onto reason; unknown → 'other' + flag)
//   status         → status      (lowercased onto the closed enum; Withdrawn →
//                                  cancelled; unknown → 'pending' + flag)
//   archived       → archived
//
// CHECK: ehow leave_requests enforces to_date >= from_date. A reversed span is
// blocked here (issue 'to_date_before_from_date') — never emitted.
//
// LOSSY CASE — individual_days:
//   nspbmir's individual_days is a jsonb list of non-contiguous dates a request
//   covers. The normalized target has ONLY a from_date..to_date span — there is
//   NO column for non-contiguous days. We keep the span (min..max of the listed
//   days, falling back to date_start/date_end) and FLAG the row as
//   needs_decision('individual_days') so it is reviewed, never silently dropped.

import { makeUuid } from './transform-teams.ts';
import type { IdentityResolver } from './identity-bridge.ts';

const IMPORTED_FROM = 'nspbmir';

export interface SourceLeave {
  id: number | string;
  requester_name: string | null;
  leave_type: string | null;
  date_start: string | null;
  date_end: string | null;
  note: string | null;
  approver_name: string | null;
  individual_days: unknown;     // jsonb — array of date strings, or null
  status: string | null;
  archived: boolean | null;
}

export type LeaveType =
  | 'annual' | 'sick' | 'personal' | 'long_service' | 'unpaid' | 'tafe' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TargetLeave {
  leave_request_id: string;
  tenant_id: string;
  staff_id: string;
  leave_type: LeaveType;
  from_date: string;            // ISO date (YYYY-MM-DD)
  to_date: string;
  hours_requested?: number;
  status: LeaveStatus;
  reason?: string | null;
  approver_id?: string | null;
  decided_at?: string | null;
  decision_notes?: string | null;
  archived?: boolean;
  imported_at?: string | null;
  imported_from?: string | null;
}

export interface LeaveResult {
  ok: boolean;
  row: TargetLeave | null;
  // Non-fatal flags worth surfacing even when ok:true (e.g. lossy span).
  warnings: string[];           // 'lossy_individual_days', 'unmapped_leave_type', ...
  // Fatal issues that block the would-be insert.
  issues: string[];             // 'unmatched_requester', 'missing_dates'
  needsDecision: boolean;       // true when a lossy/ambiguous case needs a human call
  source: { id: string; requester_name: string | null };
}

// nspbmir leave_type strings → closed target enum. Tolerant of case/spacing;
// anything unrecognized maps to 'other' and is flagged (not dropped).
//
// The leave_requests target enum is per-table and DIFFERS from schedule_entries:
//   leave_requests.leave_type ∈
//     {annual, sick, personal, long_service, unpaid, tafe, other}  — NO 'rdo'.
// The live nspbmir source vocabulary (verified) is A/L → annual, U/L → unpaid,
// RDO → (no enum bucket here) → 'other' + a LOSSLESS verbatim carrier. The
// schedule_entries table DOES have 'rdo'; a roster RDO cell maps there. Same
// word, different target per table — see transform-schedule.ts and the PR note.
const LEAVE_TYPE_MAP: Record<string, LeaveType> = {
  annual: 'annual', 'annual leave': 'annual', holiday: 'annual',
  'a/l': 'annual', al: 'annual', ann: 'annual',
  sick: 'sick', 'sick leave': 'sick', 'personal/carers': 'personal',
  personal: 'personal', carers: 'personal', "carer's": 'personal',
  'long service': 'long_service', long_service: 'long_service', lsl: 'long_service',
  unpaid: 'unpaid', 'unpaid leave': 'unpaid', loa: 'unpaid',
  'u/l': 'unpaid', ul: 'unpaid', lwop: 'unpaid',
  tafe: 'tafe', training: 'tafe', other: 'other',
  // RDO is intentionally NOT in this map: leave_requests has no 'rdo' enum value.
  // It is handled specially in transformLeave() — folds to 'other' + the verbatim
  // 'RDO' carried losslessly so the round-trip is recoverable.
};

// Source leave_type tokens that have NO leave_requests enum home but ARE a real,
// recognised category (so they should fold to 'other' WITHOUT a noisy
// 'unmapped_leave_type' warning, and WITH a lossless verbatim carrier). RDO is
// the canonical case: it is a valid schedule_entries enum but absent from
// leave_requests. Schema-gap flagged for Royce in the PR.
const LEAVE_TYPE_CARRIER_OTHER = new Set(['rdo']);

const STATUS_MAP: Record<string, LeaveStatus> = {
  pending: 'pending', requested: 'pending', submitted: 'pending', new: 'pending',
  approved: 'approved', accepted: 'approved',
  rejected: 'rejected', declined: 'rejected', denied: 'rejected',
  cancelled: 'cancelled', canceled: 'cancelled', withdrawn: 'cancelled',
};

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Best-effort text → ISO date (YYYY-MM-DD). Source dates are text; accept ISO
// and common DD/MM/YYYY (au) forms. Returns null when unparseable.
export function toIsoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Already ISO-ish: take the date part.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY or D/M/YYYY (Australian)
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) {
    const d = au[1].padStart(2, '0');
    const m = au[2].padStart(2, '0');
    return `${au[3]}-${m}-${d}`;
  }
  return null;
}

// Pull the candidate date list out of individual_days (jsonb). Accepts an array
// of strings, or an array of { date } objects. Returns the ISO dates it could
// parse. Non-array / null → [].
function extractIndividualDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const d = toIsoDate(item);
      if (d) out.push(d);
    } else if (item && typeof item === 'object' && 'date' in item) {
      const d = toIsoDate(String((item as { date: unknown }).date));
      if (d) out.push(d);
    }
  }
  return out;
}

export function transformLeave(
  src: SourceLeave,
  tenantId: string,
  resolver: IdentityResolver,
): LeaveResult {
  const warnings: string[] = [];
  const issues: string[] = [];
  let needsDecision = false;

  const requester = resolver.byName(src.requester_name);
  if (!requester.staff_id) {
    issues.push(requester.via === 'ambiguous' ? 'ambiguous_requester' : 'unmatched_requester');
  }

  // Approver is optional — unmatched is a warning, not a block.
  let approverId: string | null = null;
  if (src.approver_name && src.approver_name.trim()) {
    const ap = resolver.byName(src.approver_name);
    if (ap.staff_id) approverId = ap.staff_id;
    else warnings.push('unmatched_approver');
  }

  const individualDays = extractIndividualDays(src.individual_days);
  let fromDate = toIsoDate(src.date_start);
  let toDate = toIsoDate(src.date_end);

  // Lossy case: non-contiguous days have no normalized home. Keep the SPAN
  // (prefer explicit start/end; otherwise min..max of the listed days) and flag.
  if (individualDays.length > 0) {
    const sorted = [...individualDays].sort();
    const spanMin = sorted[0];
    const spanMax = sorted[sorted.length - 1];
    // A request is "non-contiguous" if the listed-day count is fewer than the
    // calendar span it covers — i.e. there are gaps. We can't always know that
    // cheaply, so we flag whenever individual_days is present AND either it has
    // gaps OR no explicit start/end was given.
    if (!fromDate) fromDate = spanMin;
    if (!toDate) toDate = spanMax;
    warnings.push('lossy_individual_days');
    needsDecision = true;
  }

  if (!fromDate || !toDate) {
    issues.push('missing_dates');
  } else if (toDate < fromDate) {
    // ehow app_data.leave_requests CHECK: to_date >= from_date. A reversed span
    // would be rejected by the DB on apply — block it here, loudly, rather than
    // emit a row that can never land.
    issues.push('to_date_before_from_date');
  }

  // leave_type. RDO (and any other carrier-only token) has no leave_requests
  // enum bucket → 'other' + lossless verbatim carrier; this is the per-table
  // distinction the brief calls out (schedule_entries DOES have 'rdo').
  const leaveTypeKey = norm(src.leave_type);
  let leaveType: LeaveType;
  let typeCarrier: string | null = null;
  if (LEAVE_TYPE_CARRIER_OTHER.has(leaveTypeKey)) {
    leaveType = 'other';
    typeCarrier = (src.leave_type ?? '').trim() || null;   // verbatim 'RDO'
    warnings.push('rdo_folded_to_other');                  // schema-gap flag
    needsDecision = true;
  } else {
    leaveType = LEAVE_TYPE_MAP[leaveTypeKey] ?? 'other';
    if (leaveTypeKey && !LEAVE_TYPE_MAP[leaveTypeKey]) {
      warnings.push('unmapped_leave_type');
      typeCarrier = (src.leave_type ?? '').trim() || null; // keep the unknown token
    }
  }

  const statusKey = norm(src.status);
  const status: LeaveStatus = STATUS_MAP[statusKey] ?? 'pending';
  if (statusKey && !STATUS_MAP[statusKey]) warnings.push('unmapped_status');

  const source = { id: String(src.id), requester_name: src.requester_name };

  if (issues.length > 0) {
    return { ok: false, row: null, warnings, issues, needsDecision, source };
  }

  // Lossless carrier: when the source leave_type collapsed onto 'other' (RDO or
  // an unknown token) the verbatim value must survive so the round-trip is
  // recoverable. The normalized table has no spare type column, so we prefix it
  // onto `reason` with a structured "[leave_type: RDO]" tag the read-back can
  // strip. Never silently dropped.
  let reason = src.note ?? null;
  if (typeCarrier) {
    const tag = `[leave_type: ${typeCarrier}]`;
    reason = reason ? `${tag} ${reason}` : tag;
  }

  const row: TargetLeave = {
    leave_request_id: makeUuid('leave_request', tenantId, String(src.id)),
    tenant_id: tenantId,
    staff_id: requester.staff_id!,
    leave_type: leaveType,
    from_date: fromDate!,
    to_date: toDate!,
    status,
    reason,
    approver_id: approverId,
    archived: src.archived ?? false,
    imported_at: null,           // set at apply time, not in the pure transform
    imported_from: IMPORTED_FROM,
  };

  return { ok: true, row, warnings, issues, needsDecision, source };
}
