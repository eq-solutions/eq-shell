// Briefing engine — shared between ai-briefing.ts (HTTP) and scheduled-briefing.ts (cron).
//
// `generateBrief(tenantId)` fetches all data sources, calls Claude, and returns
// a structured FullBriefingResponse. It does not touch the HTTP layer, caching,
// or sessions — those are the caller's concern.

import {
  getTenantDataClientById,
} from './tenant-routing.js';
import { getServiceClient } from './supabase.js';
import { captureServerError } from './sentry.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ANTHROPIC_API_VERSION  = '2023-06-01';
// Haiku: the briefing is a short, structured tool_use summary — Haiku is plenty
// and roughly halves generation time vs Sonnet. Bump to sonnet-4-6 if quality regresses.
export const BRIEF_MODEL     = 'claude-haiku-4-5';
export const BRIEF_MAX_TOKENS = 1024;

const LOOKBACK_HOURS      = 72;   // canonical events + dismissed-items dedup window
const LICENCE_EXPIRY_DAYS = 90;   // surface licences expiring within this window
const SERVICE_DUE_DAYS    = 14;   // surface assets whose next service falls within this window
const SIGNAL_ROW_CAP      = 8;    // max rows per signal (counts still reported in full)
const QUOTE_EXPIRY_DAYS   = 7;    // surface quotes expiring within this window
const QUOTE_STALE_DAYS    = 14;   // submitted/reviewing for longer than this = stale
const SCHEDULE_HORIZON_DAYS = 14; // window for "deployed vs bench" capacity calc

// ── Per-tenant source flags ───────────────────────────────────────────────────

export interface BriefSources {
  events:        boolean;
  pipeline:      boolean;
  licences:      boolean;
  asset_service: boolean;
  defects:       boolean;
  incidents:     boolean;
  quotes:        boolean;
}

export const DEFAULT_SOURCES: BriefSources = {
  events: true, pipeline: true, licences: true,
  asset_service: true, defects: true, incidents: true, quotes: true,
};

export function resolveSources(raw: unknown): BriefSources {
  if (!raw || typeof raw !== 'object') return DEFAULT_SOURCES;
  const o = raw as Record<string, unknown>;
  return {
    events:        o.events        !== false,
    pipeline:      o.pipeline      !== false,
    licences:      o.licences      !== false,
    asset_service: o.asset_service !== false,
    defects:       o.defects       !== false,
    incidents:     o.incidents     !== false,
    quotes:        o.quotes        !== false,
  };
}

// ── Structured output tool ────────────────────────────────────────────────────

export const SUBMIT_BRIEFING_TOOL = {
  name: 'submit_briefing',
  description: 'Submit the structured morning briefing for the operations dashboard.',
  input_schema: {
    type: 'object' as const,
    required: ['brief', 'actions'],
    properties: {
      brief: {
        type: 'string',
        description: 'Plain-English 2-3 sentence operational briefing. No markdown. No bullet points. Lead with the most urgent item. Surface cross-app connections where they exist.',
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
            title:    { type: 'string', description: 'Short imperative action, 8 words or fewer. Put any date in the deadline field, never in the title.' },
            source:   { type: 'string', description: 'App that owns this: eq-field, eq-service, eq-quotes, eq-ops, eq-cards, sks-pipeline.' },
            app_link: { type: 'string', enum: ['field', 'service', 'quotes', 'ops', 'cards'], description: 'App slug for navigation. Use ops for EQ Ops quote actions.' },
            deadline: { type: 'string', description: 'Human deadline string, e.g. "3 days", "overdue 18h", "closes Friday". Omit if none.' },
            urgency:  { type: 'string', enum: ['critical', 'high', 'normal'], description: 'critical = compliance/safety/contract. high = commercial risk or overdue. normal = housekeeping.' },
          },
        },
      },
      on_shift: {
        type: 'array',
        description: 'Headline staff on shift, taken verbatim from shift.started payload "on_shift" array. Never invented.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name:  { type: 'string' },
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
            day:    { type: 'string' },
            time:   { type: 'string' },
            label:  { type: 'string' },
            source: { type: 'string' },
          },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = `You are the operations briefing assistant for EQ Solutions. You synthesise data from multiple apps into a structured morning briefing for a busy operations manager.

DATA SOURCES YOU RECEIVE:
- canonical_events: recent activity from EQ Field (licences, shifts), EQ Service (defects, maintenance), EQ Quotes (quotes), EQ Cards (staff)
- pipeline_summary: SKS tender pipeline — stage counts, verbal agreements (≥90%), confirmed jobs, resource capacity
- pipeline_events: recent tender stage changes (last 48h)
- licences_expiring: staff credentials expiring soon — current-state snapshot
- service_due: assets/tools overdue or shortly due for service or calibration — current-state snapshot
- open_defects / open_incidents: unresolved asset defects and safety incidents — current-state snapshot
- quote_signals: EQ Ops quote pipeline — ready-to-invoice, expiring, verbal wins without job number, stale submissions — current-state snapshot
- recently_actioned: items the user already dismissed or marked done — do NOT re-surface these

RULES:
- Always use the submit_briefing tool. Never reply in free text.
- Brief: 2-3 sentences, plain English, no markdown. Lead with the most urgent item. Name people, sites, and references explicitly ONLY when they appear verbatim in the data — never infer or invent. Surface cross-app connections.
- Recency: events are tagged [recent <12h] or [older]. Lead with [recent <12h] items. Treat [older] items as background context. Raise older items only if still unresolved or time-critical.
- Snapshots (licences_expiring, service_due, open_defects, open_incidents, quote_signals) are current state, not new activity — no recency tag. A large backlog warrants one summarising action, not one per item.
- Actions: max 3. Rank by: compliance/safety first, operational gaps second, commercial third. Skip anything in recently_actioned. Keep each title a short imperative (8 words or fewer). Dates go in the deadline field. Use app_link "ops" for EQ Ops quote actions.
- On shift: only from shift.started events where occurred_at is within 12 hours. Never invent names.
- Upcoming: only items with a verifiable future date from the data.
- GROUNDING (critical): every name, site, client, number, reference, and date in your output must trace to a specific line in the data. If it is not in the data, it does not go in the briefing. When uncertain, omit.`;

// ── Types ─────────────────────────────────────────────────────────────────────

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

type PipelineResult =
  | { ok: true;  pipeline: PipelineSummary | null }
  | { ok: false; reason: string };

interface LicenceExpiry  { staff_name: string | null; licence_type: string | null; licence_number: string | null; expiry_date: string; days_left: number; }
interface ServiceDueItem { asset_name: string | null; asset_type: string | null; site_name: string | null; criticality: string | null; next_service_due: string; days_overdue: number; }
interface DefectItem     { description: string | null; severity: string | null; asset_name: string | null; site_name: string | null; raised_date: string | null; }
interface IncidentItem   { incident_type: string | null; severity: string | null; site_name: string | null; occurred_at: string | null; notifiable: boolean; }

interface QuoteSignalItem {
  quote_number:  string;
  project_name:  string | null;
  customer_name: string | null;
  estimator:     string | null;
  total_cents:   number;
}
interface QuoteExpiring extends QuoteSignalItem { expires_at: string; days_left: number; }
interface QuoteStale    extends QuoteSignalItem { status: string; sent_at: string; days_waiting: number; }

interface QuoteSignals {
  ready_to_invoice:   { items: QuoteSignalItem[]; total: number };
  expiring_soon:      { items: QuoteExpiring[];   total: number };
  verbal_wins_no_job: { items: QuoteSignalItem[]; total: number };
  stale_submitted:    { items: QuoteStale[];      total: number };
}

interface OperationalSignals {
  licences:  { items: LicenceExpiry[];  total: number };
  service:   { items: ServiceDueItem[]; total: number };
  defects:   { items: DefectItem[];     total: number };
  incidents: { items: IncidentItem[];   total: number };
  quotes:    QuoteSignals;
}

interface AiAction   { rank: number; title: string; source: string; app_link?: string; deadline?: string; urgency: 'critical' | 'high' | 'normal'; }
interface AiOnShift  { name: string; site?: string; since?: string; }
interface AiUpcoming { day?: string; time?: string; label: string; source: string; }

export interface FullBriefingResponse {
  ok:                    boolean;
  brief:                 string | null;
  actions:               AiAction[];
  on_shift:              AiOnShift[];
  shift_scheduled_count: number | null;
  upcoming:              AiUpcoming[];
  pipeline:              PipelineSummary | null;
  contributing_sources:  string[];
  degraded:              string[];
  generated_at:          string;
}

interface NameMaps {
  sites:     Map<string, string>;
  staff:     Map<string, string>;
  customers: Map<string, string>;
}

// ── Pipeline helpers ──────────────────────────────────────────────────────────

const TERMINAL_STAGES   = new Set(['lost', 'withdrawn']);
const VERBAL_STAGE      = 'likely';
const WON_STAGE         = 'won';

async function fetchPipelineSummary(url: string, apiKey: string): Promise<PipelineResult> {
  try {
    const res = await fetch(`${url}/.netlify/functions/pipeline-summary`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = await res.json() as { ok: boolean; pipeline: PipelineSummary };
    return body.ok ? { ok: true, pipeline: body.pipeline } : { ok: false, reason: 'endpoint_not_ok' };
  } catch (e) {
    return { ok: false, reason: `fetch_failed: ${(e as Error).message}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deriveCapacity(tenantDb: any, activeTenderIds: string[]): Promise<{
  headcount: number; peak_demand: number; bench: number | null;
  workersByTender: Map<string, number>; startByTender: Map<string, string>;
}> {
  const workersByTender = new Map<string, number>();
  const startByTender   = new Map<string, string>();
  let headcount = 0, peak_demand = 0;
  let bench: number | null = null;

  try {
    const r = await tenantDb.schema('app_data').from('staff').select('staff_id', { count: 'exact', head: true }).eq('active', true);
    headcount = r.count ?? 0;
  } catch { /* no staff table */ }

  if (activeTenderIds.length > 0) {
    try {
      const r = await tenantDb.schema('app_data').from('tender_nominations')
        .select('tender_id, staff_id, start_date')
        .in('tender_id', activeTenderIds);
      const distinct = new Set<string>();
      for (const n of (r.data ?? []) as Array<{ tender_id: string; staff_id: string | null; start_date: string | null }>) {
        workersByTender.set(n.tender_id, (workersByTender.get(n.tender_id) ?? 0) + 1);
        if (n.staff_id) distinct.add(n.staff_id);
        if (n.start_date) {
          const cur = startByTender.get(n.tender_id);
          if (!cur || n.start_date < cur) startByTender.set(n.tender_id, n.start_date);
        }
      }
      peak_demand = distinct.size;
    } catch { /* no nominations */ }
  }

  try {
    const today   = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + SCHEDULE_HORIZON_DAYS * 86400000).toISOString().slice(0, 10);
    const r = await tenantDb.schema('app_data').from('schedule_entries')
      .select('staff_id, leave_type').gte('date', today).lte('date', horizon);
    const sched = (r.data ?? []) as Array<{ staff_id: string | null; leave_type: string | null }>;
    if (sched.length > 0 && headcount > 0) {
      const deployed = new Set<string>();
      for (const s of sched) if (s.staff_id && !s.leave_type) deployed.add(s.staff_id);
      bench = Math.max(0, headcount - deployed.size);
    }
  } catch { /* no schedule */ }

  return { headcount, peak_demand, bench, workersByTender, startByTender };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchNativePipeline(tenantDb: any): Promise<PipelineSummary | null> {
  try {
    const r = await tenantDb.schema('app_data').from('tenders')
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
      if (TERMINAL_STAGES.has(stage)) continue;
      const value = Number(t.estimated_value_cents ?? 0);
      total += value;
      (by_stage[stage] ??= { count: 0, value_cents: 0 });
      by_stage[stage].count++;
      by_stage[stage].value_cents += value;
      activeTenderIds.push(t.tender_id);
      const job_name = t.title ?? t.tender_number ?? 'tender';
      if (stage === VERBAL_STAGE) verbal_agreement.push({ job_name, client: t.client_name ?? null, value_cents: value, due_date: t.close_date ?? null, probability_label: 'likely' });
      if (stage === WON_STAGE)    wonTenders.push({ tender_id: t.tender_id, job_name, client: t.client_name ?? null, value_cents: value, close_date: t.close_date ?? null });
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

    return { total_value_cents: total, by_stage, verbal_agreement, confirmed_jobs, headcount: cap.headcount, peak_demand: cap.peak_demand, bench: cap.bench };
  } catch {
    return null;
  }
}

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

// ── Operational signal fetchers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadNameMaps(tenantDb: any): Promise<NameMaps> {
  const sites     = new Map<string, string>();
  const staff     = new Map<string, string>();
  const customers = new Map<string, string>();

  await Promise.allSettled([
    (async () => {
      const r = await tenantDb.schema('app_data').from('sites').select('site_id, name');
      for (const s of (r.data ?? []) as Array<{ site_id: string; name: string | null }>) {
        if (s.name) sites.set(s.site_id, s.name);
      }
    })(),
    (async () => {
      const r = await tenantDb.schema('app_data').from('staff').select('staff_id, first_name, last_name, preferred_name');
      for (const p of (r.data ?? []) as Array<{ staff_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>) {
        const name = [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        if (name) staff.set(p.staff_id, name);
      }
    })(),
    (async () => {
      const r = await tenantDb.schema('app_data').from('customers').select('customer_id, company_name');
      for (const c of (r.data ?? []) as Array<{ customer_id: string; company_name: string | null }>) {
        if (c.company_name) customers.set(c.customer_id, c.company_name);
      }
    })(),
  ]);

  return { sites, staff, customers };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchLicenceExpiries(tenantDb: any, names: NameMaps): Promise<{ items: LicenceExpiry[]; total: number }> {
  try {
    const cutoff = new Date(Date.now() + LICENCE_EXPIRY_DAYS * 86400000).toISOString().slice(0, 10);
    const r = await tenantDb.schema('app_data').from('licences')
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
        days_left:      Math.round((new Date(l.expiry_date).getTime() - today) / 86400000),
      }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchServiceDue(tenantDb: any, names: NameMaps): Promise<{ items: ServiceDueItem[]; total: number }> {
  try {
    const horizon = new Date(Date.now() + SERVICE_DUE_DAYS * 86400000).toISOString().slice(0, 10);
    const r = await tenantDb.schema('app_data').from('assets')
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
        days_overdue:     Math.round((today - new Date(a.next_service_due).getTime()) / 86400000),
      }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOpenDefects(tenantDb: any): Promise<{ items: DefectItem[]; total: number }> {
  try {
    const r = await tenantDb.schema('app_data').from('asset_defects')
      .select('description, severity, raised_date', { count: 'exact' })
      .is('resolution_date', null)
      .neq('status', 'resolved')
      .order('raised_date', { ascending: true })
      .limit(SIGNAL_ROW_CAP);
    if (r.error) return { items: [], total: 0 };
    const items = ((r.data ?? []) as Array<{ description: string | null; severity: string | null; raised_date: string | null }>)
      .map(d => ({ description: d.description, severity: d.severity, asset_name: null, site_name: null, raised_date: d.raised_date }));
    return { items, total: r.count ?? items.length };
  } catch { return { items: [], total: 0 }; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOpenIncidents(tenantDb: any, names: NameMaps): Promise<{ items: IncidentItem[]; total: number }> {
  try {
    const r = await tenantDb.schema('app_data').from('incidents')
      .select('incident_type, severity, site_id, occurred_at, notifiable_to_regulator', { count: 'exact' })
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchQuoteSignals(tenantDb: any, names: NameMaps): Promise<QuoteSignals> {
  const empty: QuoteSignals = {
    ready_to_invoice:   { items: [], total: 0 },
    expiring_soon:      { items: [], total: 0 },
    verbal_wins_no_job: { items: [], total: 0 },
    stale_submitted:    { items: [], total: 0 },
  };
  try {
    const today        = new Date().toISOString().slice(0, 10);
    const expiryCutoff = new Date(Date.now() + QUOTE_EXPIRY_DAYS  * 86400000).toISOString().slice(0, 10);
    const staleCutoff  = new Date(Date.now() - QUOTE_STALE_DAYS   * 86400000).toISOString();

    const [rtiRes, expRes, verbRes, staleRes] = await Promise.all([
      tenantDb.schema('app_data').from('quote')
        .select('quote_number, project_name, estimator_name, total_cents, customer_id', { count: 'exact' })
        .eq('status', 'ready-to-invoice')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(SIGNAL_ROW_CAP),

      tenantDb.schema('app_data').from('quote')
        .select('quote_number, project_name, estimator_name, total_cents, customer_id, expires_at', { count: 'exact' })
        .in('status', ['submitted', 'client-reviewing', 'on-hold', 'verbal-win'])
        .is('deleted_at', null)
        .gte('expires_at', today)
        .lte('expires_at', expiryCutoff)
        .order('expires_at', { ascending: true })
        .limit(SIGNAL_ROW_CAP),

      tenantDb.schema('app_data').from('quote')
        .select('quote_number, project_name, estimator_name, total_cents, customer_id', { count: 'exact' })
        .in('status', ['verbal-win', 'won-awaiting-job-no'])
        .is('deleted_at', null)
        .is('workbench_job_no', null)
        .order('created_at', { ascending: false })
        .limit(SIGNAL_ROW_CAP),

      tenantDb.schema('app_data').from('quote')
        .select('quote_number, project_name, estimator_name, total_cents, customer_id, status, sent_at', { count: 'exact' })
        .in('status', ['submitted', 'client-reviewing'])
        .is('deleted_at', null)
        .not('sent_at', 'is', null)
        .lte('sent_at', staleCutoff)
        .order('sent_at', { ascending: true })
        .limit(SIGNAL_ROW_CAP),
    ]);

    const now_ms = Date.now();

    type RawQuote = { quote_number: string; project_name: string | null; estimator_name: string | null; total_cents: number | null; customer_id: string | null };
    const mapRow = (r: RawQuote): QuoteSignalItem => ({
      quote_number:  r.quote_number,
      project_name:  r.project_name,
      customer_name: r.customer_id ? names.customers.get(r.customer_id) ?? null : null,
      estimator:     r.estimator_name,
      total_cents:   r.total_cents ?? 0,
    });

    return {
      ready_to_invoice: {
        items: ((rtiRes.data ?? []) as RawQuote[]).map(mapRow),
        total: rtiRes.count ?? 0,
      },
      expiring_soon: {
        items: ((expRes.data ?? []) as (RawQuote & { expires_at: string })[]).map(r => ({
          ...mapRow(r),
          expires_at: r.expires_at,
          days_left:  Math.round((new Date(r.expires_at).getTime() - now_ms) / 86400000),
        })),
        total: expRes.count ?? 0,
      },
      verbal_wins_no_job: {
        items: ((verbRes.data ?? []) as RawQuote[]).map(mapRow),
        total: verbRes.count ?? 0,
      },
      stale_submitted: {
        items: ((staleRes.data ?? []) as (RawQuote & { status: string; sent_at: string })[]).map(r => ({
          ...mapRow(r),
          status:       r.status,
          sent_at:      r.sent_at,
          days_waiting: Math.round((now_ms - new Date(r.sent_at).getTime()) / 86400000),
        })),
        total: staleRes.count ?? 0,
      },
    };
  } catch {
    return empty;
  }
}

// ── Payload enrichment + shift dedup ─────────────────────────────────────────

function enrichPayload(payload: Record<string, unknown>, names: NameMaps): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  const sid  = out.site_id;
  const stid = out.staff_id;
  if (typeof sid  === 'string' && names.sites.has(sid))  out.site  = names.sites.get(sid);
  if (typeof stid === 'string' && names.staff.has(stid)) out.staff = names.staff.get(stid);
  return out;
}

function deduplicateShiftEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  const bestByDay = new Map<string, CanonicalEvent>();
  const other: CanonicalEvent[] = [];
  for (const e of events) {
    if (e.event !== 'shift.started') { other.push(e); continue; }
    const day = e.occurred_at.slice(0, 10);
    const existing = bestByDay.get(day);
    if (!existing) { bestByDay.set(day, e); continue; }
    const curNames  = Array.isArray(existing.payload?.on_shift) && (existing.payload.on_shift as unknown[]).length > 0;
    const candNames = Array.isArray(e.payload?.on_shift)        && (e.payload.on_shift        as unknown[]).length > 0;
    const curCount  = typeof existing.payload?.scheduled_count === 'number' ? existing.payload.scheduled_count : 0;
    const candCount = typeof e.payload?.scheduled_count        === 'number' ? e.payload.scheduled_count        : 0;
    if ((!curNames && candNames) || (curNames === candNames && candCount > curCount)) {
      bestByDay.set(day, e);
    }
  }
  const deduped = [...bestByDay.values(), ...other];
  deduped.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return deduped;
}

function groundOnShift(onShift: AiOnShift[], context: string): { kept: AiOnShift[]; dropped: number } {
  const haystack = context.toLowerCase();
  const kept = onShift.filter(s => {
    const name = (s.name ?? '').trim().toLowerCase();
    return name.length > 1 && haystack.includes(name);
  });
  return { kept, dropped: onShift.length - kept.length };
}

// ── User message builder ──────────────────────────────────────────────────────

function aud(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
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

  if (signals.licences.total > 0) {
    lines.push('');
    lines.push(`LICENCES EXPIRING (within ${LICENCE_EXPIRY_DAYS} days — ${signals.licences.total} total):`);
    for (const l of signals.licences.items) {
      const who  = l.staff_name ?? 'unassigned';
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
      const crit  = a.criticality ? ` [${a.criticality}]` : '';
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
      const sev   = i.severity ? `[${i.severity}] ` : '';
      const where = i.site_name ? ` @ ${i.site_name}` : '';
      const flag  = i.notifiable ? ' — NOTIFIABLE TO REGULATOR' : '';
      lines.push(`  ${sev}${i.incident_type ?? 'incident'}${where}${i.occurred_at ? ` at ${i.occurred_at}` : ''}${flag}`);
    }
  }

  // ── Quote signals ──────────────────────────────────────────────────────────
  const qs = signals.quotes;
  const hasQuotes = qs.ready_to_invoice.total > 0 || qs.expiring_soon.total > 0
    || qs.verbal_wins_no_job.total > 0 || qs.stale_submitted.total > 0;

  if (hasQuotes) {
    lines.push('');
    lines.push('QUOTE PIPELINE SIGNALS (EQ Ops — current state):');

    if (qs.ready_to_invoice.total > 0) {
      lines.push(`  Ready to invoice (${qs.ready_to_invoice.total} total):`);
      for (const q of qs.ready_to_invoice.items) {
        const cust = q.customer_name ? ` (${q.customer_name})` : '';
        const who  = q.estimator ? ` [${q.estimator}]` : '';
        lines.push(`    ${q.quote_number}${cust} — ${aud(q.total_cents)} ex GST${who}`);
      }
    }

    if (qs.expiring_soon.total > 0) {
      lines.push(`  Expiring within ${QUOTE_EXPIRY_DAYS} days (${qs.expiring_soon.total} total):`);
      for (const q of qs.expiring_soon.items) {
        const cust = q.customer_name ? ` (${q.customer_name})` : '';
        lines.push(`    ${q.quote_number}${cust} — ${aud(q.total_cents)} ex GST, expires ${q.expires_at} (${q.days_left}d)`);
      }
    }

    if (qs.verbal_wins_no_job.total > 0) {
      lines.push(`  Verbal wins without job number (${qs.verbal_wins_no_job.total} total):`);
      for (const q of qs.verbal_wins_no_job.items) {
        const cust = q.customer_name ? ` (${q.customer_name})` : '';
        const proj = q.project_name ? ` "${q.project_name}"` : '';
        lines.push(`    ${q.quote_number}${cust}${proj} — ${aud(q.total_cents)} ex GST`);
      }
    }

    if (qs.stale_submitted.total > 0) {
      lines.push(`  Stale submitted/reviewing (${qs.stale_submitted.total} total, >${QUOTE_STALE_DAYS} days no response):`);
      for (const q of qs.stale_submitted.items) {
        const cust = q.customer_name ? ` (${q.customer_name})` : '';
        lines.push(`    ${q.quote_number}${cust} — ${aud(q.total_cents)} ex GST, sent ${q.sent_at.slice(0, 10)} (${q.days_waiting}d waiting)`);
      }
    }
  }

  if (pipeline) {
    lines.push('');
    lines.push('PIPELINE SUMMARY (SKS NSW Labour):');
    lines.push(`Total active pipeline: ${aud(pipeline.total_value_cents)}`);
    for (const [stage, data] of Object.entries(pipeline.by_stage)) {
      lines.push(`  ${stage}: ${data.count} tenders, ${aud(data.value_cents)}`);
    }
    if (pipeline.verbal_agreement.length > 0) {
      lines.push('Verbal agreements (≥90%):');
      for (const t of pipeline.verbal_agreement) {
        lines.push(`  ${t.job_name} (${t.client ?? '?'}) — ${aud(t.value_cents)}${t.due_date ? ', due ' + t.due_date : ''}`);
      }
    }
    if (pipeline.confirmed_jobs.length > 0) {
      lines.push('Confirmed jobs:');
      for (const j of pipeline.confirmed_jobs) {
        lines.push(`  ${j.job_name} — ${aud(j.value_cents)}, ${j.peak_workers ?? '?'} workers${j.start_date ? ', starts ' + j.start_date : ''}`);
      }
    }
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
    lines.push('RECENTLY ACTIONED (do not re-surface unless underlying event changed):');
    for (const a of actioned) {
      lines.push(`  [${a.state}] "${a.action_title}" (${a.action_source}) — ${a.created_at}`);
    }
  }

  return lines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateBrief(tenantId: string): Promise<FullBriefingResponse> {
  const tenantDb = await getTenantDataClientById(tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Tenant config: pipeline endpoint + per-tenant brief sources
  let pipelineUrl: string | null = null;
  let pipelineApiKey: string | null = null;
  let sources: BriefSources = DEFAULT_SOURCES;
  try {
    const shared = getServiceClient();
    let cfg = await shared.from('tenants').select('pipeline_url, pipeline_api_key, brief_sources').eq('id', tenantId).single();
    if (cfg.error) cfg = await shared.from('tenants').select('pipeline_url, pipeline_api_key').eq('id', tenantId).single();
    const row = cfg.data as { pipeline_url?: string | null; pipeline_api_key?: string | null; brief_sources?: unknown } | null;
    pipelineUrl    = row?.pipeline_url    ?? null;
    pipelineApiKey = row?.pipeline_api_key ?? null;
    sources        = resolveSources(row?.brief_sources);
  } catch { /* non-fatal */ }

  const needNames = sources.events || sources.licences || sources.asset_service || sources.incidents || sources.quotes;
  const names = needNames ? await loadNameMaps(tenantAny) : { sites: new Map(), staff: new Map(), customers: new Map() };

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600000).toISOString();

  const [eventsRes, actionedRes, pipelineOut, licences, service, defects, incidents, quotes] = await Promise.all([
    sources.events
      ? tenantAny.schema('app_data').from('canonical_events')
          .select('id, app_source, event, payload, occurred_at')
          .gte('occurred_at', cutoff)
          .order('occurred_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),

    tenantAny.schema('app_data').from('briefing_actions')
      .select('action_title, action_source, state, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false }),

    sources.pipeline
      ? resolvePipeline(tenantAny, pipelineUrl, pipelineApiKey)
      : Promise.resolve({ pipeline: null, degraded: false }),

    sources.licences      ? fetchLicenceExpiries(tenantAny, names) : Promise.resolve({ items: [], total: 0 }),
    sources.asset_service ? fetchServiceDue(tenantAny, names)      : Promise.resolve({ items: [], total: 0 }),
    sources.defects       ? fetchOpenDefects(tenantAny)            : Promise.resolve({ items: [], total: 0 }),
    sources.incidents     ? fetchOpenIncidents(tenantAny, names)   : Promise.resolve({ items: [], total: 0 }),
    sources.quotes        ? fetchQuoteSignals(tenantAny, names)    : Promise.resolve({ ready_to_invoice: { items: [], total: 0 }, expiring_soon: { items: [], total: 0 }, verbal_wins_no_job: { items: [], total: 0 }, stale_submitted: { items: [], total: 0 } } as QuoteSignals),
  ]);

  if (eventsRes.error) throw new Error(`canonical events query failed: ${eventsRes.error.message}`);

  const events  = deduplicateShiftEvents((eventsRes.data ?? []) as CanonicalEvent[]);
  const actioned = (actionedRes.data ?? []) as BriefingAction[];

  const pipeline  = pipelineOut.pipeline;
  const degraded: string[] = [];
  if (pipelineOut.degraded) degraded.push('pipeline');

  const signals: OperationalSignals = { licences, service, defects, incidents, quotes };
  const hasSignals = licences.total > 0 || service.total > 0 || defects.total > 0 || incidents.total > 0
    || quotes.ready_to_invoice.total > 0 || quotes.expiring_soon.total > 0
    || quotes.verbal_wins_no_job.total > 0 || quotes.stale_submitted.total > 0;

  const contributing_sources = [
    ...new Set(events.map(e => e.app_source)),
    ...(pipeline                              ? ['pipeline']    : []),
    ...(licences.total  > 0                  ? ['licences']    : []),
    ...(service.total   > 0                  ? ['service_due'] : []),
    ...(defects.total   > 0                  ? ['defects']     : []),
    ...(incidents.total > 0                  ? ['incidents']   : []),
    ...(quotes.ready_to_invoice.total > 0 || quotes.expiring_soon.total > 0
        || quotes.verbal_wins_no_job.total > 0 || quotes.stale_submitted.total > 0
      ? ['quotes'] : []),
  ];

  const latestShift = events.find(e => e.event === 'shift.started' && e.app_source === 'field');
  const shift_scheduled_count: number | null = latestShift
    ? (typeof latestShift.payload.scheduled_count === 'number' ? latestShift.payload.scheduled_count : null)
    : null;

  const generated_at = new Date().toISOString();

  const emptyResponse: FullBriefingResponse = {
    ok: true, brief: null, actions: [], on_shift: [], shift_scheduled_count,
    upcoming: [], pipeline, contributing_sources, degraded, generated_at,
  };

  if (events.length === 0 && !pipeline && !hasSignals) return emptyResponse;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

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

  const grounded = groundOnShift(payload.on_shift ?? [], userMessage);
  if (grounded.dropped > 0) {
    console.warn('[briefing-engine] dropped ungrounded on_shift entries', { tenantId, dropped: grounded.dropped });
  }

  return {
    ok:                    true,
    brief:                 payload.brief ?? null,
    actions:               payload.actions ?? [],
    on_shift:              grounded.kept,
    shift_scheduled_count,
    upcoming:              payload.upcoming ?? [],
    pipeline,
    contributing_sources,
    degraded,
    generated_at,
  };
}

// Re-export for callers that need the error to identify type
export { captureServerError };
