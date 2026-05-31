// POST /.netlify/functions/generate-gm-briefing
//
// Uses Anthropic tool_use to guarantee valid structured output — no JSON.parse,
// no regex stripping, no SyntaxError risk. Claude must populate the tool schema
// or the API returns an error; it never returns malformed JSON.
//
// Body: { period_id: string }
// Auth: manager or platform_admin only.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Tool schema — Claude MUST call this tool with valid inputs.
// No text parsing, no JSON.parse — the API validates the schema.
// ---------------------------------------------------------------------------

const BRIEFING_TOOL = {
  name: 'create_briefing',
  description: 'Creates a structured GM briefing from job data',
  input_schema: {
    type: 'object',
    properties: {
      top_concern: {
        type: 'string',
        description: 'Single biggest issue in one sentence. Be specific: name the PM and the job.',
      },
      critical_jobs: {
        type: 'array',
        description: 'Jobs with forecast_loss=true (exclude overhead codes with cv=0)',
        items: {
          type: 'object',
          properties: {
            job_code:       { type: 'string' },
            job_description:{ type: 'string' },
            job_manager:    { type: 'string' },
            contract_value: { type: 'number' },
            cash_gap:       { type: 'number', description: 'Positive = cash deficit' },
            gp_forecast:    { type: 'number' },
            action:         { type: 'string', description: 'One sentence: what the GM should do' },
          },
          required: ['job_code', 'job_description', 'job_manager', 'contract_value', 'cash_gap', 'gp_forecast', 'action'],
        },
      },
      watch_jobs: {
        type: 'array',
        description: 'Cash-negative jobs with positive GP — invoicing catch-up needed',
        items: {
          type: 'object',
          properties: {
            job_code:       { type: 'string' },
            job_description:{ type: 'string' },
            job_manager:    { type: 'string' },
            cash_gap:       { type: 'number' },
            gp_forecast:    { type: 'number' },
            action:         { type: 'string' },
          },
          required: ['job_code', 'job_description', 'job_manager', 'cash_gap', 'gp_forecast', 'action'],
        },
      },
      pm_summary: {
        type: 'array',
        description: 'One entry per PM. Exclude overhead-only PMs. Sort worst first.',
        items: {
          type: 'object',
          properties: {
            name:         { type: 'string' },
            job_count:    { type: 'integer' },
            cash_position:{ type: 'number', description: 'Negative = cash deficit' },
            gp_forecast:  { type: 'number' },
            status:       { type: 'string', enum: ['red', 'amber', 'green'] },
            note:         { type: 'string', description: 'One sentence summary' },
          },
          required: ['name', 'job_count', 'cash_position', 'gp_forecast', 'status', 'note'],
        },
      },
      portfolio_note: {
        type: 'string',
        description: '2-3 sentences for the GM. Cover the overhead code caveat (many cash-negative entries are internal codes with no revenue — not billing problems). Plain English.',
      },
    },
    required: ['top_concern', 'critical_jobs', 'watch_jobs', 'pm_summary', 'portfolio_note'],
  },
};

const SYSTEM_PROMPT =
  'You are an AI analyst for a GM briefing at an electrical contracting company. ' +
  'Use the create_briefing tool to structure your response. ' +
  'Be direct and specific — name PMs, jobs, dollar amounts. ' +
  'Overhead codes (Estimating Hours, Defects/Liability, FY26 buckets — identifiable by cv=0) have no revenue by design. Exclude them from critical/watch lists. ' +
  'cash_gap > 0 means cash deficit (spent more than claimed). ' +
  'PM cash_position: negative = deficit.';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'reports.generate_briefing')) {
    return json(403, { error: 'forbidden' });
  }

  let body: { period_id?: string };
  try {
    body = await req.json() as { period_id?: string };
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const { period_id } = body;
  if (!period_id) return json(400, { error: 'missing_period_id' });

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (
      e instanceof TenantNotFoundError ||
      e instanceof TenantNotActiveError ||
      e instanceof TenantRoutingMisconfiguredError
    ) {
      captureServerError(e, { context: 'generate-gm-briefing:routing', tenant_id: session.tenant_id });
      return json(503, { error: 'tenant_unavailable', detail: String(e) });
    }
    throw e;
  }

  const { data: period, error: pErr } = await db
    .from('gm_report_periods')
    .select('id, period_code, total_contract, net_cash_position, gp_at_completion, overall_gp_pct, cash_neg_count, forecast_loss_count')
    .eq('id', period_id)
    .single();

  if (pErr || !period) return json(404, { error: 'period_not_found' });

  const { data: jobs, error: jErr } = await db
    .from('gm_report_jobs')
    .select('job_manager, job_code, job_description, contract_valuation, jtd_invoicing, jtd_cost_val, gross_profit, outstanding_pos, cash_gap, is_cash_negative, is_forecast_loss, is_overhead')
    .eq('period_id', period_id);

  if (jErr || !jobs) return json(500, { error: 'db_error', detail: jErr?.message });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { error: 'ai_not_configured' });

  // Top 15 non-overhead jobs: losses first, then biggest cash gap
  const topJobs = [...jobs]
    .filter(j => !j.is_overhead && (j.is_forecast_loss || j.is_cash_negative))
    .sort((a, b) => {
      if (a.is_forecast_loss !== b.is_forecast_loss) return a.is_forecast_loss ? -1 : 1;
      return (b.cash_gap ?? 0) - (a.cash_gap ?? 0);
    })
    .slice(0, 15)
    .map(j => ({
      code: j.job_code,
      pm:   j.job_manager,
      desc: j.job_description.slice(0, 60),
      cv:   Math.round(j.contract_valuation ?? 0),
      gap:  Math.round(j.cash_gap ?? 0),
      gp:   Math.round(j.gross_profit ?? 0),
      loss: j.is_forecast_loss,
      pos:  Math.round(j.outstanding_pos ?? 0),
    }));

  // PM rollup (non-overhead only)
  const pmMap = new Map<string, { jobs: number; cash: number; gp: number }>();
  for (const j of jobs.filter(x => !x.is_overhead)) {
    const e = pmMap.get(j.job_manager) ?? { jobs: 0, cash: 0, gp: 0 };
    e.jobs++;
    e.cash -= (j.cash_gap ?? 0);   // negate: positive DB gap = deficit = negative cash position
    e.gp   += (j.gross_profit ?? 0);
    pmMap.set(j.job_manager, e);
  }
  const pmRollup = [...pmMap.entries()]
    .sort((a, b) => a[1].cash - b[1].cash)
    .map(([name, s]) => ({ name, jobs: s.jobs, cash: Math.round(s.cash), gp: Math.round(s.gp) }));

  console.log(`[briefing] period=${period_id} total_jobs=${jobs.length} top_sent=${topJobs.length} pms=${pmRollup.length}`);

  const userMessage = JSON.stringify({
    period: period.period_code,
    portfolio: {
      total_jobs: jobs.length,
      contract: Math.round(period.total_contract ?? 0),
      net_cash: Math.round(period.net_cash_position ?? 0),
      gp: Math.round(period.gp_at_completion ?? 0),
      gp_pct: `${((period.overall_gp_pct ?? 0) * 100).toFixed(1)}%`,
      cash_neg: period.cash_neg_count,
      losses: period.forecast_loss_count,
    },
    top_jobs: topJobs,
    pm_rollup: pmRollup,
  });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model:       MODEL,
        max_tokens:  2000,
        system:      SYSTEM_PROMPT,
        tools:       [BRIEFING_TOOL],
        tool_choice: { type: 'tool', name: 'create_briefing' },
        messages:    [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json() as {
      stop_reason?: string;
      content?: { type: string; name?: string; input?: unknown }[];
    };

    // tool_use response — input is already a validated JS object, no JSON.parse needed
    const toolBlock = (data.content ?? []).find(b => b.type === 'tool_use' && b.name === 'create_briefing');
    if (!toolBlock?.input) {
      throw new Error(`Claude did not call create_briefing. stop_reason=${data.stop_reason} content=${JSON.stringify(data.content).slice(0, 200)}`);
    }

    const briefing = toolBlock.input;

    await db
      .from('gm_report_periods')
      .update({ briefing, briefing_generated_at: new Date().toISOString() })
      .eq('id', period_id);

    return json(200, { ok: true, briefing });
  } catch (e) {
    captureServerError(e, { context: 'generate-gm-briefing', tenant_id: session.tenant_id });
    return json(500, { error: 'briefing_failed', detail: String(e) });
  }
});
