// GET /.netlify/functions/ai-briefing
//
// Fully structured AI morning briefing. Synthesises data from:
//   - Last 48h canonical_events on the tenant data plane
//   - SKS pipeline summary (per-tenant config in shell_control.tenants)
//   - Recent actioned/dismissed items (last 48h) to avoid re-surfacing
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
const BRIEF_MODEL            = 'claude-sonnet-4-5';
const BRIEF_MAX_TOKENS       = 1024;
const CACHE_TTL_MS           = 10 * 60 * 1000; // 10 minutes

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
        description: 'Staff on shift from shift.started events in last 12 hours.',
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
- recently_actioned: items the user already dismissed or marked done — do NOT re-surface these

RULES:
- Always use the submit_briefing tool. Never reply in free text.
- Brief: 2-3 sentences, plain English, no markdown. Lead with the most urgent item. Name people, sites, and references explicitly. Surface cross-app connections.
- Actions: max 3. Rank by: compliance/safety first, operational gaps second, commercial third. Skip anything in recently_actioned.
- On shift: only from shift.started events where occurred_at is within 12 hours. Extract name and site from payload.
- Upcoming: only items with a verifiable future date from the data. Pipeline start_date_estimated qualifies.
- Do not invent data. Only report what the events and pipeline data explicitly show.`;

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

interface FullBriefingResponse {
  ok:                   boolean;
  brief:                string | null;
  actions:              AiAction[];
  on_shift:             AiOnShift[];
  upcoming:             AiUpcoming[];
  pipeline:             PipelineSummary | null;
  contributing_sources: string[];
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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function fetchPipelineSummary(url: string, apiKey: string): Promise<PipelineSummary | null> {
  try {
    const res = await fetch(`${url}/.netlify/functions/pipeline-summary`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('[ai-briefing] pipeline-summary returned', res.status);
      return null;
    }
    const body = await res.json() as { ok: boolean; pipeline: PipelineSummary };
    return body.ok ? body.pipeline : null;
  } catch (e) {
    console.warn('[ai-briefing] pipeline-summary fetch failed:', (e as Error).message);
    return null;
  }
}

function buildUserMessage(
  events:   CanonicalEvent[],
  pipeline: PipelineSummary | null,
  actioned: BriefingAction[],
): string {
  const now = new Date().toISOString();
  const h12 = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const lines: string[] = [`Current time: ${now}`, ''];

  if (events.length > 0) {
    lines.push(`CANONICAL EVENTS (last 48h — ${events.length} total):`);
    for (const e of events) {
      const tag = e.occurred_at >= h12 ? '[recent <12h]' : '[older]';
      lines.push(`${tag} ${e.app_source}/${e.event} at ${e.occurred_at}: ${JSON.stringify(e.payload)}`);
    }
  } else {
    lines.push('CANONICAL EVENTS: none in last 48h');
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
    lines.push(`Headcount: ${pipeline.headcount} · Peak demand: ${pipeline.peak_demand}${pipeline.bench !== null ? ` · Bench: ${pipeline.bench}` : ''}`);
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

  // ── Tenant pipeline config ─────────────────────────────────────────────
  let pipelineUrl: string | null = null;
  let pipelineApiKey: string | null = null;
  try {
    const shared = getServiceClient();
    const cfgRes = await shared
      .from('tenants')
      .select('pipeline_url, pipeline_api_key')
      .eq('id', tenantId)
      .single();
    pipelineUrl    = (cfgRes.data as { pipeline_url?: string | null })?.pipeline_url    ?? null;
    pipelineApiKey = (cfgRes.data as { pipeline_api_key?: string | null })?.pipeline_api_key ?? null;
  } catch {
    // Non-fatal — no pipeline
  }

  // ── Parallel data fetch ────────────────────────────────────────────────
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const [eventsRes, actionedRes, pipeline] = await Promise.all([
    tenantAny
      .schema('app_data')
      .from('canonical_events')
      .select('id, app_source, event, payload, occurred_at')
      .gte('occurred_at', cutoff48h)
      .order('occurred_at', { ascending: false })
      .limit(30),

    tenantAny
      .schema('app_data')
      .from('briefing_actions')
      .select('action_title, action_source, state, created_at')
      .eq('user_id', userId)
      .gte('created_at', cutoff48h)
      .order('created_at', { ascending: false }),

    pipelineUrl && pipelineApiKey
      ? fetchPipelineSummary(pipelineUrl, pipelineApiKey)
      : Promise.resolve(null),
  ]);

  if (eventsRes.error) {
    console.warn('[ai-briefing] canonical events query failed', { tenantId, error: eventsRes.error.message });
  }

  const events  = (eventsRes.data ?? [])   as CanonicalEvent[];
  const actioned = (actionedRes.data ?? []) as BriefingAction[];

  const contributing_sources = [
    ...new Set(events.map(e => e.app_source)),
    ...(pipeline ? ['pipeline'] : []),
  ];

  const emptyResponse: FullBriefingResponse = {
    ok: true, brief: null, actions: [], on_shift: [], upcoming: [],
    pipeline, contributing_sources, generated_at: new Date().toISOString(),
  };

  if (events.length === 0 && !pipeline) {
    await writeCache(tenantAny, userId, emptyResponse);
    return json(200, emptyResponse);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.info('[ai-briefing] ANTHROPIC_API_KEY not set');
    await writeCache(tenantAny, userId, emptyResponse);
    return json(200, emptyResponse);
  }

  // ── Claude synthesis ───────────────────────────────────────────────────
  try {
    const userMessage = buildUserMessage(events, pipeline, actioned);

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

    const fullResponse: FullBriefingResponse = {
      ok:                   true,
      brief:                payload.brief ?? null,
      actions:              payload.actions ?? [],
      on_shift:             payload.on_shift ?? [],
      upcoming:             payload.upcoming ?? [],
      pipeline,
      contributing_sources,
      generated_at:         new Date().toISOString(),
    };

    await writeCache(tenantAny, userId, fullResponse);
    return json(200, fullResponse);

  } catch (e) {
    captureServerError(e, { context: 'ai-briefing', tenantId });
    console.warn('[ai-briefing] synthesis failed:', (e as Error).message);
    await writeCache(tenantAny, userId, emptyResponse);
    return json(200, emptyResponse);
  }
});

// ── Cache write ───────────────────────────────────────────────────────────

async function writeCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any,
  userId:   string,
  payload:  FullBriefingResponse,
): Promise<void> {
  try {
    await tenantDb
      .schema('app_data')
      .from('briefing_cache')
      .upsert(
        { user_id: userId, payload, generated_at: payload.generated_at },
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
