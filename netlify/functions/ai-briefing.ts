// GET /.netlify/functions/ai-briefing
//
// Fully structured AI morning briefing. Synthesises data from:
//   - Last 72h canonical_events on the tenant data plane (LOOKBACK_HOURS)
//   - SKS pipeline summary (per-tenant config in shell_control.tenants)
//   - Recent actioned/dismissed items (same 72h window) to avoid re-surfacing
//
// Response (all fields always present):
//   {
//     ok: true,
//     brief:                string | null,
//     actions:              Action[],          // max 3, ranked
//     on_shift:             OnShift[],
//     upcoming:             Upcoming[],
//     pipeline:             PipelineSummary | null,
//     contributing_sources: string[],          // which apps had data
//     generated_at:         string,
//   }
//
// Caching: per-user 10-minute cache in app_data.briefing_cache.
//   Bypass with ?refresh=1 (manual regenerate button).
//   Cache is also invalidated by briefing-action.ts on dismiss/done.
//
// Pipeline config: read from shell_control.tenants.pipeline_url +
//   pipeline_api_key — NOT from global env vars.
//
// Non-fatal: every sub-step degrades gracefully.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
// Haiku — the dashboard brief is a short, structured (tool_use) summary, so
// Haiku is plenty and roughly halves the generation time vs Sonnet. Matches
// generate-gm-briefing. Bump back to sonnet-4-6 if brief quality regresses.
const BRIEF_MODEL            = 'claude-haiku-4-5';
const BRIEF_MAX_TOKENS       = 1024;
const CACHE_TTL_MS           = 10 * 60 * 1000; // 10 minutes
// Lookback window for canonical events AND the dismissed-items dedup list.
// Both queries below share this so the "already actioned" filter always covers
// the same span as the events — widening one without the other re-surfaces
// items you've dismissed. 72h covers a long weekend without going stale.
const LOOKBACK_HOURS         = 72;

// Operational-signal thresholds + caps for the direct table reads (below).
const LICENCE_EXPIRY_DAYS    = 90;  // surface licences expiring within this window
const SERVICE_DUE_DAYS       = 14;  // surface assets whose next service falls within this window
const SIGNAL_ROW_CAP         = 8;   // max rows rendered per operational signal (counts still reported in full)

// Per-tenant brief sources. Each flag gates one data source feeding the brief.
// Default = all on; a tenant can narrow this via shell_control.tenants.brief_sources
// (nullable jsonb — absent column or null value ⇒ DEFAULT_SOURCES). Read tolerantly
// so the function keeps working before the migration that adds the column lands.
interface BriefSources {
  events:        boolean;  // app_data.canonical_events (cross-app activity log)
  pipeline:      boolean;  // SKS pipeline-summary endpoint
  licences:      boolean;  // app_data.licences — expiring credentials
  asset_service: boolean;  // app_data.assets — overdue / upcoming service & calibration
  defects:       boolean;  // app_data.asset_defects — open defects
  incidents:     boolean;  // app_data.incidents — open safety incidents
}

const DEFAULT_SOURCES: BriefSources = {
  events: true, pipeline: true, licences: true, asset_service: true, defects: true, incidents: true,
};

function resolveSources(raw: unknown): BriefSources {
  if (!raw || typeof raw !== 'object') return DEFAULT_SOURCES;
  const o = raw as Record<string, unknown>;
  // Absent key ⇒ keep default-on; only an explicit `false` disables a source.
  return {
    events:        o.events        !== false,
    pipeline:      o.pipeline       !== false,
    licences:      o.licences       !== false,
    asset_service: o.asset_service  !== false,
    defects:       o.defects        !== false,
    incidents:     o.incidents      !== false,
  };
}

// ── Structured output tool ────────────────────────────────────────────────

const SUBMIT_BRIEFING_TOOL = {
  name: 'submit_briefing',
  description: 'Submit the structured morning briefing for the operations dashboard.',
  input_schema: {
    type: 'object' as const,
    required: ['brief', 'actions'],
    properties: {
      brief: {
        type: 'string',
        description: 'Plain-English 2-3 sentence operational briefing. No markdown. No bullet points. Lead with the most urgent item. Surface cross-app connections where they exist (e.g. licence expiry + crew deployment on same job).',
      },
      actions: {
        type: 'array',
        maxItems: 3,
        description: 'Top actions ranked 1-3 by urgency. Omit any action already in recently_actioned context.',
        items: {
          type: 'object',
          required: ['rank', 'title', 'source', 'urgency', 'app_link'],
          properties: {
            rank:     { type: 'integer', minimum: 1, maximum: 3 },
            title:    { type: 'string', description: 'Concise action title — what to do.' },
            source:   { type: 'string', description: 'App that owns this: eq-field, eq-service, eq-quotes, eq-cards, sks-pipeline.' },
            app_link: { type: 'string', enum: ['field', 'service', 'quotes', 'cards'], description: 'App slug for navigation. Omit for sks-pipeline items.' },
            deadline: { type: 'string', description: 'Human deadline string, e.g. "3 days", "overdue 18h", "closes Friday". Omit if none.' },
            urgency:  { type: 'string', enum: ['critical', 'high', 'normal'], description: 'critical = compliance/safety/contract. high = commercial risk or overdue. normal = housekeeping.' },
          },
        },
      },
      on_shift: {
        type: 'array',
        description: 'Headline staff on shift, taken from the shift.started payload "on_shift" array (already name + human site). Not the full headcount — see scheduled_count.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name:  { type: 'string', description: 'Worker name copied verbatim from the event payload. Never invented.' },
            site:  { type: 'string' },
            since: { type: 'string', description: 'HH:MM start time.' },
          },
        },
      },
      upcoming: {
        type: 'array',
        description: 'Scheduled items in next 48 hours from maintenance, service, or pipeline start dates.',
        items: {
          type: 'object',
          required: ['label', 'source'],
          properties: {
            day:    { type: 'string', description: 'E.g. MON, TUE.' },
            time:   { type: 'string', description: 'HH:MM if known.' },
            label:  { type: 'string' },
            source: { type: 'string' },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are the operations briefing assistant for EQ Solutions. You synthesise data from multiple apps into a structured morning briefing for a busy operations manager.

DATA SOURCES YOU RECEIVE:
- canonical_events: recent activity from EQ Field (licences, shifts), EQ Service (defects, maintenance), EQ Quotes (quotes), EQ Cards (staff)
- pipeline_summary: SKS tender pipeline — stage counts, verbal agreements (≥90%), confirmed jobs, resource capacity
- pipeline_events: recent tender stage changes (last 48h)
- licences_expiring: staff credentials expiring soon — a current-state snapshot, not an event
- service_due: assets/tools overdue or shortly due for service or calibration — current-state snapshot
- open_defects / open_incidents: unresolved asset defects and safety incidents — current-state snapshot
- recently_actioned: items the user already dismissed or marked done — do NOT re-surface these

RULES:
- Always use the submit_briefing tool. Never reply in free text.
- Brief: 2-3 sentences, plain English, no markdown. Lead with the most urgent item. Name people, sites, and references explicitly ONLY when they appear verbatim in the data — never infer or invent a name. Surface cross-app connections.
- Recency: events are tagged [recent <12h] or [older]. Lead with [recent <12h] items. Treat [older] items as background context, not new alerts — only raise an older item if it is still unresolved or time-critical (e.g. an open defect, an overdue task, an expiring licence). Do not present a days-old routine event as if it just happened.
- Snapshots (licences_expiring, service_due, open_defects, open_incidents) are current state, not new activity — they have no recency tag. Treat them as standing compliance/operational obligations. A large overdue backlog is worth one summarising action ("N tools overdue calibration, oldest X days") rather than one action per item.
- Actions: max 3. Rank by: compliance/safety first, operational gaps second, commercial third. Skip anything in recently_actioned.
- On shift: only from shift.started events where occurred_at is within 12 hours. Use the most recent such event and read its payload's "on_shift" array — each entry already has a resolved "name" and human "site". If "on_shift" is absent, label the "assignments" object's site codes using the payload's "sites" map (code -> human name). Never output a raw site code; always the human site name. "scheduled_count" is the full headcount even though "on_shift" lists only the headline few. Never invent names — if the array is empty and no sites map is present, leave on_shift empty.
- Upcoming: only items with a verifiable future date from the data. Pipeline start_date_estimated qualifies.
- GROUNDING (critical): every name, site, client, number, reference, and date in your output must trace to a specific line in the data above. If it is not in the data, it does not go in the briefing. Do not infer identities or quantities. When uncertain, omit — a blank panel is correct; a plausible-looking guess is a failure.`;

// ── Types ─────────────────────────────────────────────────────────────────

interface CanonicalEvent {
  id:          string;
  app_source:  string;
  event:       string;
  payload:     Record<string, unknown>;
  occurred_at: string;
}

interface BriefingAction {
  action_title:  string;
  action_source: string;
  state:         string;
  created_at:    string;
}

interface PipelineSummary {
  total_value_cents: number;
  by_stage:          Record<string, { count: number; value_cents: number }>;
  verbal_agreement:  Array<{ job_name: string; client: string | null; value_cents: number; due_date: string | null; probability_label: string | null }>;
  confirmed_jobs:    Array<{ job_name: string; client: string | null; value_cents: number; peak_workers: number | null; start_date: string | null; duration_weeks: number | null }>;
  headcount:         number;
  peak_demand:       number;
  bench:             number | null;
  recent_events?:    Array<{ event: string; payload: Record<string, unknown>; occurred_at: string }>;
}

// Current-state operational snapshots read directly from the tenant data plane.
interface LicenceExpiry  { staff_name: string | null; licence_type: string | null; licence_number: string | null; expiry_date: string; days_left: number; }
interface ServiceDueItem { asset_name: string | null; asset_type: string | null; site_name: string | null; criticality: string | null; next_service_due: string; days_overdue: number; }
interface DefectItem     { description: string | null; severity: string | null; asset_name: string | null; site_name: string | null; raised_date: string | null; }
interface IncidentItem   { incident_type: string | null; severity: string | null; site_name: string | null; occurred_at: string | null; notifiable: boolean; }

interface OperationalSignals {
  licences:  { items: LicenceExpiry[];  total: number };
  service:   { items: ServiceDueItem[]; total: number };
  defects:   { items: DefectItem[];     total: number };
  incidents: { items: IncidentItem[];   total: number };
}

interface FullBriefingResponse {
  ok:                   boolean;
  brief:                string | null;
  actions:              AiAction[];
  on_shift:             AiOnShift[];
  upcoming:             AiUpcoming[];
  pipeline:             PipelineSummary | null;
  contributing_sources: string[];
  // Sources that were configured/expected but could not be read this run (e.g. the
  // pipeline endpoint 500'd). Surfaced so a silent failure is visible to the UI and
  // caller instead of the block just vanishing from the brief.
  degraded:             string[];
  generated_at:         string;
}

interface AiAction {
  rank:      number;
  title:     string;
  source:    string;
  app_link?: string;
  deadline?: string;
  urgency:   'critical' | 'high' | 'normal';
}

interface AiOnShift  { name: string; site?: string; since?: string; }
interface AiUpcoming { day?: string; time?: string; label: string; source: string; }

// ── Helpers ───────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

// Discriminated result so a failed pipeline fetch is reported, not silently dropped.
type PipelineResult =
  | { ok: true;  pipeline: PipelineSummary | null }
  | { ok: false; reason: string };

async function fetchPipelineSummary(url: string, apiKey: string): Promise<PipelineResult> {
  try {
    const res = await fetch(`${url}/.netlify/functions/pipeline-summary`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('[ai-briefing] pipeline-summary returned', res.status);
      return { ok: false, reason: `http_${res.status}` };
    }
    const body = await res.json() as { ok: boolean; pipeline: PipelineSummary };
    return body.ok ? { ok: true, pipeline: body.pipeline } : { ok: false, reason: 'endpoint_not_ok' };
  } catch (e) {
    console.warn('[ai-briefing] pipeline-summary fetch failed:', (e as Error).message);
    return { ok: false, reason: 'fetch_failed' };
  }
}

// Canonical tender stage vocabulary — the CHECK constraint on app_data.tenders.stage
// and the tender schema doc fix it as: watch → confirmed → likely → won | lost |
// withdrawn (probability ascending). Mapped to the brief's pipeline buckets:
//   - active pipeline  = all non-terminal stages (everything except lost/withdrawn)
//   - verbal agreement = 'likely'  (≥90% likely to win, not yet secured)
//   - confirmed job     = 'won'     (secured work)
// NOTE the trap: stage 'confirmed' is an EARLY stage (confirmed opportunity we're
// pursuing), NOT a won job — it belongs in by_stage only, never confirmed_jobs.
const TERMINAL_STAGES = new Set(['lost', 'withdrawn']);
const VERBAL_STAGE    = 'likely';
const WON_STAGE       = 'won';
const SCHEDULE_HORIZON_DAYS = 14;  // window for "deployed vs bench"

// Native pipeline summary, read directly from the EQ Field SKS tenant's
// app_data.tenders + resourcing tables. Returns null when there are no tender rows
// (the table is empty today) — the caller then falls back to the legacy external
// fetch. Dormant path: activates automatically once the pipeline becomes native
// EQ Field data, at which point the external pipeline_url/key retire.
//
// Capacity (headcount / peak_demand / bench) is derived from the canonical
// resourcing tables: staff (headcount), tender_nominations (per-job workers +
// peak demand), schedule_entries (deployment → bench). Each is best-effort and
// degrades to a safe default; bench is left null when there's no schedule data so
// buildUserMessage omits the line rather than implying everyone is benched.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchNativePipeline(tenantDb: any): Promise<PipelineSummary | null> {
  try {
    const r = await tenantDb
      .schema('app_data').from('tenders')
      .select('tender_id, tender_number, title, client_name, stage, estimated_value_cents, close_date')
      .limit(500);
    if (r.error) return null;
    const rows = (r.data ?? []) as Array<{ tender_id: string; tender_number: string | null; title: string | null; client_name: string | null; stage: string | null; estimated_value_cents: number | null; close_date: string | null }>;
    if (rows.length === 0) return null;

    const by_stage: Record<string, { count: number; value_cents: number }> = {};
    const verbal_agreement: PipelineSummary['verbal_agreement'] = [];
    const wonTenders: Array<{ tender_id: string; job_name: string; client: string | null; value_cents: number; close_date: string | null }> = [];
    const activeTenderIds: string[] = [];
    let total = 0;

    for (const t of rows) {
      const stage = (t.stage ?? 'unknown').trim().toLowerCase();
      if (TERMINAL_STAGES.has(stage)) continue;  // exclude lost/withdrawn from active pipeline
      const value = Number(t.estimated_value_cents ?? 0);
      total += value;
      (by_stage[stage] ??= { count: 0, value_cents: 0 });
      by_stage[stage].count      += 1;
      by_stage[stage].value_cents += value;
      activeTenderIds.push(t.tender_id);
      const job_name = t.title ?? t.tender_number ?? 'tender';
      if (stage === VERBAL_STAGE) {
        verbal_agreement.push({ job_name, client: t.client_name ?? null, value_cents: value, due_date: t.close_date ?? null, probability_label: 'likely' });
      }
      if (stage === WON_STAGE) {
        wonTenders.push({ tender_id: t.tender_id, job_name, client: t.client_name ?? null, value_cents: value, close_date: t.close_date ?? null });
      }
    }

    const cap = await deriveCapacity(tenantDb, activeTenderIds);

    const confirmed_jobs: PipelineSummary['confirmed_jobs'] = wonTenders.map(w => ({
      job_name:       w.job_name,
      client:         w.client,
      value_cents:    w.value_cents,
      peak_workers:   cap.workersByTender.get(w.tender_id) ?? null,
      start_date:     cap.startByTender.get(w.tender_id) ?? w.close_date,
      duration_weeks: null,
    }));

    return {
      total_value_cents: total,
      by_stage,
      verbal_agreement,
      confirmed_jobs,
      headcount:   cap.headcount,
      peak_demand: cap.peak_demand,
      bench:       cap.bench,
    };
  } catch {
    return null;
  }
}

// Derive resourcing capacity from the canonical tables. All best-effort:
//   headcount    — count of active staff
//   peak_demand  — distinct staff nominated across the active tenders
//   bench        — active staff not deployed in schedule over the next 14 days
//                  (null when there's no schedule data — "unknown", not "all free")
//   workersByTender / startByTender — per-tender nomination count + earliest start,
//                  used to fill confirmed_jobs.peak_workers / start_date
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deriveCapacity(tenantDb: any, activeTenderIds: string[]): Promise<{
  headcount: number; peak_demand: number; bench: number | null;
  workersByTender: Map<string, number>; startByTender: Map<string, string>;
}> {
  const workersByTender = new Map<string, number>();
  const startByTender   = new Map<string, string>();
  let headcount = 0;
  let peak_demand = 0;
  let bench: number | null = null;

  try {
    const r = await tenantDb.schema('app_data').from('staff').select('staff_id', { count: 'exact', head: true }).eq('active', true);
    headcount = r.count ?? 0;
  } catch { /* no staff table — headcount stays 0 */ }

  if (activeTenderIds.length > 0) {
    try {
      const r = await tenantDb.schema('app_data').from('tender_nominations')
        .select('tender_id, staff_id, start_date')
        .in('tender_id', activeTenderIds);
      const distinctStaff = new Set<string>();
      for (const n of (r.data ?? []) as Array<{ tender_id: string; staff_id: string | null; start_date: string | null }>) {
        workersByTender.set(n.tender_id, (workersByTender.get(n.tender_id) ?? 0) + 1);
        if (n.staff_id) distinctStaff.add(n.staff_id);
        if (n.start_date) {
          const cur = startByTender.get(n.tender_id);
          if (!cur || n.start_date < cur) startByTender.set(n.tender_id, n.start_date);
        }
      }
      peak_demand = distinctStaff.size;
    } catch { /* no nominations — peak_demand stays 0 */ }
  }

  try {
    const today   = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await tenantDb.schema('app_data').from('schedule_entries')
      .select('staff_id, leave_type')
      .gte('date', today)
      .lte('date', horizon);
    const sched = (r.data ?? []) as Array<{ staff_id: string | null; leave_type: string | null }>;
    if (sched.length > 0 && headcount > 0) {
      const deployed = new Set<string>();
      for (const s of sched) if (s.staff_id && !s.leave_type) deployed.add(s.staff_id);
      bench = Math.max(0, headcount - deployed.size);
    }
  } catch { /* no schedule — bench stays null (unknown) */ }

  return { headcount, peak_demand, bench, workersByTender, startByTender };
}

// Resolve the pipeline summary: prefer native EQ Field tenant data; fall back to
// the legacy external pipeline-summary fetch only when there's no native data.
// `degraded` is true when the external fallback was attempted and failed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePipeline(tenantDb: any, url: string | null, apiKey: string | null): Promise<{ pipeline: PipelineSummary | null; degraded: boolean }> {
  const native = await fetchNativePipeline(tenantDb);
  if (native) return { pipeline: native, degraded: false };
  if (url && apiKey) {
    const r = await fetchPipelineSummary(url, apiKey);
    return r.ok ? { pipeline: r.pipeline, degraded: false } : { pipeline: null, degraded: true };
  }
  return { pipeline: null, degraded: false };
}

// ── Direct tenant-data-plane reads (operational snapshots) ─────────────────
//
// Each helper is self-contained and degrades to an empty result on any error
// (missing table, empty tenant, RLS) so the brief never fails because one
// signal is unavailable. `tenantDb` is the app_data-scoped service-role client.

interface NameMaps { sites: Map<string, string>; staff: Map<string, string>; }

// Resolve site_id → site name and staff_id → person name once, for reuse across
// signals and for best-effort enrichment of opaque event payloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadNameMaps(tenantDb: any): Promise<NameMaps> {
  const sites = new Map<string, string>();
  const staff = new Map<string, string>();
  try {
    const r = await tenantDb.schema('app_data').from('sites').select('site_id, name');
    for (const s of (r.data ?? []) as Array<{ site_id: string; name: string | null }>) {
      if (s.name) sites.set(s.site_id, s.name);
    }
  } catch { /* no sites table / empty — fine */ }
  try {
    const r = await tenantDb.schema('app_data').from('staff').select('staff_id, first_name, last_name, preferred_name');
    for (const p of (r.data ?? []) as Array<{ staff_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>) {
      const name = [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      if (name) staff.set(p.staff_id, name);
    }
  } catch { /* no staff table / empty — fine */ }
  return { sites, staff };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchLicenceExpiries(tenantDb: any, names: NameMaps): Promise<{ items: LicenceExpiry[]; total: number }> {
  try {
    const cutoff = new Date(Date.now() + LICENCE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await tenantDb
      .schema('app_data').from('licences')
      .select('staff_id, licence_type, licence_number, expiry_date', { count: 'exact' })
      .eq('active', true)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', cutoff)
      .order('expiry_date', { ascending: true })
      .limit(SIGNAL_ROW_CAP);
    if (r.error) return { items: [], total: 0 };
    const today = Date.now();
    const items = ((r.data ?? []) as Array<{ staff_id: string | null; licence_type: string | null; licence_number: string | null; expiry_date: string }>)
      .map(l => ({
        staff_name:     l.staff_id ? names.staff.get(l.staff_id) ?? null : null,
        licence_type:   l.licence_type,
        licence_number: l.licence_number,
        expiry_date:    l.expiry_date,
        days_left:      Math.round((new Date(l.expiry_date).getTime() - today) / 86_400_000),
      }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchServiceDue(tenantDb: any, names: NameMaps): Promise<{ items: ServiceDueItem[]; total: number }> {
  try {
    const horizon = new Date(Date.now() + SERVICE_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await tenantDb
      .schema('app_data').from('assets')
      .select('name, asset_type, site_id, criticality, next_service_due', { count: 'exact' })
      .eq('active', true)
      .not('next_service_due', 'is', null)
      .lte('next_service_due', horizon)
      .order('next_service_due', { ascending: true })
      .limit(SIGNAL_ROW_CAP);
    if (r.error) return { items: [], total: 0 };
    const today = Date.now();
    const items = ((r.data ?? []) as Array<{ name: string | null; asset_type: string | null; site_id: string | null; criticality: string | null; next_service_due: string }>)
      .map(a => ({
        asset_name:       a.name,
        asset_type:       a.asset_type,
        site_name:        a.site_id ? names.sites.get(a.site_id) ?? null : null,
        criticality:      a.criticality,
        next_service_due: a.next_service_due,
        days_overdue:     Math.round((today - new Date(a.next_service_due).getTime()) / 86_400_000),
      }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOpenDefects(tenantDb: any): Promise<{ items: DefectItem[]; total: number }> {
  try {
    const r = await tenantDb
      .schema('app_data').from('asset_defects')
      .select('description, severity, asset_id, raised_date, status, resolution_date', { count: 'exact' })
      .is('resolution_date', null)
      .neq('status', 'resolved')
      .order('raised_date', { ascending: true })
      .limit(SIGNAL_ROW_CAP);
    if (r.error) return { items: [], total: 0 };
    // asset → site resolution would need an extra round-trip; asset name lives on
    // app_data.assets, not loaded here, so we surface description + severity only.
    const items = ((r.data ?? []) as Array<{ description: string | null; severity: string | null; raised_date: string | null }>)
      .map(d => ({ description: d.description, severity: d.severity, asset_name: null, site_name: null, raised_date: d.raised_date }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOpenIncidents(tenantDb: any, names: NameMaps): Promise<{ items: IncidentItem[]; total: number }> {
  try {
    const r = await tenantDb
      .schema('app_data').from('incidents')
      .select('incident_type, severity, site_id, occurred_at, status, notifiable_to_regulator', { count: 'exact' })
      .neq('status', 'closed')
      .order('occurred_at', { ascending: false })
      .limit(SIGNAL_ROW_CAP);
    if (r.error) return { items: [], total: 0 };
    const items = ((r.data ?? []) as Array<{ incident_type: string | null; severity: string | null; site_id: string | null; occurred_at: string | null; notifiable_to_regulator: boolean | null }>)
      .map(i => ({
        incident_type: i.incident_type,
        severity:      i.severity,
        site_name:     i.site_id ? names.sites.get(i.site_id) ?? null : null,
        occurred_at:   i.occurred_at,
        notifiable:    i.notifiable_to_regulator === true,
      }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// Best-effort: rewrite known id fields inside an event payload to human names so
// the model sees "Sydney DC" instead of a bare uuid. Ids that don't resolve in
// this tenant's tables (e.g. a Service-domain site_id) are left untouched.
function enrichPayload(payload: Record<string, unknown>, names: NameMaps): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  const sid = out.site_id;
  if (typeof sid === 'string' && names.sites.has(sid)) out.site = names.sites.get(sid);
  const stid = out.staff_id;
  if (typeof stid === 'string' && names.staff.has(stid)) out.staff = names.staff.get(stid);
  return out;
}

// Server-side grounding guard — defense in depth behind the prompt rules. Drops
// any on_shift entry whose worker name does not appear in the data we actually
// sent the model. shift.started payloads carry no names today, so this strips a
// fabricated roster outright until the emit side supplies real names. Simple
// case-insensitive containment against the assembled user message — cheap, no
// extra model call. Scoped to on_shift (a structured name field) where the
// fabrication risk is concrete; free-text action titles rely on the prompt rules.
function groundOnShift(onShift: AiOnShift[], context: string): { kept: AiOnShift[]; dropped: number } {
  const haystack = context.toLowerCase();
  const kept = onShift.filter(s => {
    const name = (s.name ?? '').trim().toLowerCase();
    return name.length > 1 && haystack.includes(name);
  });
  return { kept, dropped: onShift.length - kept.length };
}

function buildUserMessage(
  events:   CanonicalEvent[],
  pipeline: PipelineSummary | null,
  actioned: BriefingAction[],
  signals:  OperationalSignals,
  names:    NameMaps,
): string {
  const now = new Date().toISOString();
  const h12 = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const lines: string[] = [`Current time: ${now}`, ''];

  if (events.length > 0) {
    lines.push(`CANONICAL EVENTS (last ${LOOKBACK_HOURS}h — ${events.length} total):`);
    for (const e of events) {
      const tag = e.occurred_at >= h12 ? '[recent <12h]' : '[older]';
      lines.push(`${tag} ${e.app_source}/${e.event} at ${e.occurred_at}: ${JSON.stringify(enrichPayload(e.payload, names))}`);
    }
  } else {
    lines.push(`CANONICAL EVENTS: none in last ${LOOKBACK_HOURS}h`);
  }

  // ── Operational snapshots (current state, not activity) ──────────────────
  if (signals.licences.total > 0) {
    lines.push('');
    lines.push(`LICENCES EXPIRING (within ${LICENCE_EXPIRY_DAYS} days — ${signals.licences.total} total):`);
    for (const l of signals.licences.items) {
      const who = l.staff_name ?? 'unassigned';
      const what = [l.licence_type, l.licence_number].filter(Boolean).join(' ');
      lines.push(`  ${who} — ${what || 'licence'}, expires ${l.expiry_date} (${l.days_left}d)`);
    }
  }

  if (signals.service.total > 0) {
    lines.push('');
    lines.push(`SERVICE / CALIBRATION DUE (overdue or within ${SERVICE_DUE_DAYS} days — ${signals.service.total} total):`);
    for (const a of signals.service.items) {
      const where = a.site_name ? ` @ ${a.site_name}` : '';
      const state = a.days_overdue > 0 ? `${a.days_overdue}d overdue` : `due ${a.next_service_due}`;
      const crit = a.criticality ? ` [${a.criticality}]` : '';
      lines.push(`  ${a.asset_name ?? 'asset'}${where}${crit} — ${state}`);
    }
  }

  if (signals.defects.total > 0) {
    lines.push('');
    lines.push(`OPEN DEFECTS (${signals.defects.total} total):`);
    for (const d of signals.defects.items) {
      const sev = d.severity ? `[${d.severity}] ` : '';
      lines.push(`  ${sev}${d.description ?? 'defect'}${d.raised_date ? ` (raised ${d.raised_date})` : ''}`);
    }
  }

  if (signals.incidents.total > 0) {
    lines.push('');
    lines.push(`OPEN INCIDENTS (${signals.incidents.total} total):`);
    for (const i of signals.incidents.items) {
      const sev = i.severity ? `[${i.severity}] ` : '';
      const where = i.site_name ? ` @ ${i.site_name}` : '';
      const flag = i.notifiable ? ' — NOTIFIABLE TO REGULATOR' : '';
      lines.push(`  ${sev}${i.incident_type ?? 'incident'}${where}${i.occurred_at ? ` at ${i.occurred_at}` : ''}${flag}`);
    }
  }

  if (pipeline) {
    lines.push('');
    lines.push('PIPELINE SUMMARY (SKS NSW Labour):');
    const total = (pipeline.total_value_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
    lines.push(`Total active pipeline: ${total}`);
    for (const [stage, data] of Object.entries(pipeline.by_stage)) {
      const val = (data.value_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
      lines.push(`  ${stage}: ${data.count} tenders, ${val}`);
    }
    if (pipeline.verbal_agreement.length > 0) {
      lines.push('Verbal agreements (≥90%):');
      for (const t of pipeline.verbal_agreement) {
        const val = (t.value_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
        lines.push(`  ${t.job_name} (${t.client ?? '?'}) — ${val}${t.due_date ? ', due ' + t.due_date : ''}`);
      }
    }
    if (pipeline.confirmed_jobs.length > 0) {
      lines.push('Confirmed jobs:');
      for (const j of pipeline.confirmed_jobs) {
        const val = (j.value_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
        lines.push(`  ${j.job_name} — ${val}, ${j.peak_workers ?? '?'} workers, ${j.duration_weeks ?? '?'} weeks${j.start_date ? ', starts ' + j.start_date : ''}`);
      }
    }
    // Capacity is unsourced for the native (tenders-only) summary — omit the line
    // entirely rather than report a misleading "Headcount: 0".
    if (pipeline.headcount > 0 || pipeline.peak_demand > 0 || pipeline.bench !== null) {
      lines.push(`Headcount: ${pipeline.headcount} · Peak demand: ${pipeline.peak_demand}${pipeline.bench !== null ? ` · Bench: ${pipeline.bench}` : ''}`);
    }
    if (pipeline.recent_events && pipeline.recent_events.length > 0) {
      lines.push('Recent pipeline events (last 48h):');
      for (const e of pipeline.recent_events) {
        lines.push(`  ${e.event} at ${e.occurred_at}: ${JSON.stringify(e.payload)}`);
      }
    }
  }

  if (actioned.length > 0) {
    lines.push('');
    lines.push('RECENTLY ACTIONED (do not re-surface these unless underlying event changed):');
    for (const a of actioned) {
      lines.push(`  [${a.state}] "${a.action_title}" (${a.action_source}) — ${a.created_at}`);
    }
  }

  return lines.join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  const { tenant_id: tenantId, user_id: userId } = session;
  const skipCache = new URL(req.url).searchParams.has('refresh');

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // ── Cache check ────────────────────────────────────────────────────────
  if (!skipCache) {
    try {
      const cacheRes = await tenantAny
        .schema('app_data')
        .from('briefing_cache')
        .select('payload, generated_at')
        .eq('user_id', userId)
        .single();
      if (!cacheRes.error && cacheRes.data) {
        const age = Date.now() - new Date(cacheRes.data.generated_at as string).getTime();
        if (age < CACHE_TTL_MS) {
          return json(200, cacheRes.data.payload as FullBriefingResponse);
        }
      }
    } catch {
      // Cache miss is fine — proceed to generate
    }
  }

  // ── Tenant config: pipeline + per-tenant brief sources ──────────────────
  let pipelineUrl: string | null = null;
  let pipelineApiKey: string | null = null;
  let sources: BriefSources = DEFAULT_SOURCES;
  try {
    const shared = getServiceClient();
    // brief_sources may not exist yet (additive migration) — try with it first,
    // fall back to the original column set so the brief works either way.
    let cfg = await shared
      .from('tenants')
      .select('pipeline_url, pipeline_api_key, brief_sources')
      .eq('id', tenantId)
      .single();
    if (cfg.error) {
      cfg = await shared
        .from('tenants')
        .select('pipeline_url, pipeline_api_key')
        .eq('id', tenantId)
        .single();
    }
    const row = cfg.data as { pipeline_url?: string | null; pipeline_api_key?: string | null; brief_sources?: unknown } | null;
    pipelineUrl    = row?.pipeline_url    ?? null;
    pipelineApiKey = row?.pipeline_api_key ?? null;
    sources        = resolveSources(row?.brief_sources);
  } catch {
    // Non-fatal — no config, fall through with DEFAULT_SOURCES + no pipeline
  }

  // Name maps power both the operational signals (site/staff names) and best-effort
  // enrichment of opaque event payloads. Load once when any consumer is enabled.
  const needNames = sources.events || sources.licences || sources.asset_service || sources.incidents;
  const names = needNames ? await loadNameMaps(tenantAny) : { sites: new Map(), staff: new Map() };

  // ── Parallel data fetch ────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const [eventsRes, actionedRes, pipelineOut, licences, service, defects, incidents] = await Promise.all([
    sources.events
      ? tenantAny
          .schema('app_data')
          .from('canonical_events')
          .select('id, app_source, event, payload, occurred_at')
          .gte('occurred_at', cutoff)
          .order('occurred_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),

    tenantAny
      .schema('app_data')
      .from('briefing_actions')
      .select('action_title, action_source, state, created_at')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false }),

    sources.pipeline
      ? resolvePipeline(tenantAny, pipelineUrl, pipelineApiKey)
      : Promise.resolve({ pipeline: null, degraded: false }),

    sources.licences      ? fetchLicenceExpiries(tenantAny, names) : Promise.resolve({ items: [], total: 0 }),
    sources.asset_service ? fetchServiceDue(tenantAny, names)      : Promise.resolve({ items: [], total: 0 }),
    sources.defects       ? fetchOpenDefects(tenantAny)            : Promise.resolve({ items: [], total: 0 }),
    sources.incidents     ? fetchOpenIncidents(tenantAny, names)   : Promise.resolve({ items: [], total: 0 }),
  ]);

  if (eventsRes.error) {
    console.error('[ai-briefing] canonical events query failed', { tenantId, error: eventsRes.error.message });
    captureServerError(eventsRes.error, { context: 'ai-briefing:events', tenantId });
    return json(500, { ok: false, error: 'db_error', detail: eventsRes.error.message });
  }

  const events  = (eventsRes.data ?? [])   as CanonicalEvent[];

  if (actionedRes.error) {
    // Non-fatal: actioned list only prevents re-surfacing dismissed items; proceed without it.
    console.warn('[ai-briefing] briefing_actions query failed', { tenantId, error: actionedRes.error.message });
  }
  const actioned = (actionedRes.data ?? []) as BriefingAction[];

  // Pipeline: prefer native EQ Field tenant data, fall back to the external fetch.
  // `degraded` is set only when the external fallback was attempted and failed —
  // surfaced instead of the block silently vanishing.
  const pipeline = pipelineOut.pipeline;
  const degraded: string[] = [];
  if (pipelineOut.degraded) {
    degraded.push('pipeline');
    console.warn('[ai-briefing] pipeline degraded (external fallback failed)', { tenantId });
  }

  const signals: OperationalSignals = { licences, service, defects, incidents };
  const hasSignals = licences.total > 0 || service.total > 0 || defects.total > 0 || incidents.total > 0;

  const contributing_sources = [
    ...new Set(events.map(e => e.app_source)),
    ...(pipeline ? ['pipeline'] : []),
    ...(licences.total  > 0 ? ['licences']    : []),
    ...(service.total   > 0 ? ['service_due'] : []),
    ...(defects.total   > 0 ? ['defects']   : []),
    ...(incidents.total > 0 ? ['incidents'] : []),
  ];

  const emptyResponse: FullBriefingResponse = {
    ok: true, brief: null, actions: [], on_shift: [], upcoming: [],
    pipeline, contributing_sources, degraded, generated_at: new Date().toISOString(),
  };

  if (events.length === 0 && !pipeline && !hasSignals) {
    await writeCache(tenantAny, tenantId, userId, emptyResponse);
    return json(200, emptyResponse);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[ai-briefing] ANTHROPIC_API_KEY not configured — cannot generate briefing');
    return json(503, { ok: false, error: 'ai_not_configured' });
  }

  // ── Claude synthesis ───────────────────────────────────────────────────
  try {
    const userMessage = buildUserMessage(events, pipeline, actioned, signals, names);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model:       BRIEF_MODEL,
        max_tokens:  BRIEF_MAX_TOKENS,
        system:      SYSTEM_PROMPT,
        tools:       [SUBMIT_BRIEFING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_briefing' },
        messages:    [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data    = await resp.json() as { content: any[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = data.content?.find((b: any) => b.type === 'tool_use' && b.name === 'submit_briefing');
    if (!toolUse) throw new Error('Claude did not call submit_briefing');

    const payload = toolUse.input as { brief: string; actions: AiAction[]; on_shift?: AiOnShift[]; upcoming?: AiUpcoming[] };

    // Grounding guard: strip any on_shift entry whose name wasn't in the data we
    // sent the model (catches fabricated rosters the prompt rules should already
    // prevent). Logged so we can see when the model tries to invent names.
    const grounded = groundOnShift(payload.on_shift ?? [], userMessage);
    if (grounded.dropped > 0) {
      console.warn('[ai-briefing] dropped ungrounded on_shift entries', { tenantId, dropped: grounded.dropped });
    }

    const fullResponse: FullBriefingResponse = {
      ok:                   true,
      brief:                payload.brief ?? null,
      actions:              payload.actions ?? [],
      on_shift:             grounded.kept,
      upcoming:             payload.upcoming ?? [],
      pipeline,
      contributing_sources,
      degraded,
      generated_at:         new Date().toISOString(),
    };

    await writeCache(tenantAny, tenantId, userId, fullResponse);
    return json(200, fullResponse);

  } catch (e) {
    captureServerError(e, { context: 'ai-briefing', tenantId });
    console.error('[ai-briefing] synthesis failed:', (e as Error).message);
    return json(500, { ok: false, error: 'synthesis_failed', detail: (e as Error).message });
  }
});

// ── Cache write ───────────────────────────────────────────────────────────

async function writeCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any,
  tenantId: string,
  userId:   string,
  payload:  FullBriefingResponse,
): Promise<void> {
  try {
    await tenantDb
      .schema('app_data')
      .from('briefing_cache')
      .upsert(
        { tenant_id: tenantId, user_id: userId, payload, generated_at: payload.generated_at },
        { onConflict: 'user_id' },
      );
  } catch (e) {
    console.warn('[ai-briefing] cache write failed:', (e as Error).message);
  }
}

// ── Tenant routing error handler ──────────────────────────────────────────

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError)
    return json(500, { ok: false, error: 'tenant_not_provisioned' });
  if (e instanceof TenantNotActiveError)
    return json(503, { ok: false, error: 'tenant_inactive' });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[ai-briefing] routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[ai-briefing] unexpected routing error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
