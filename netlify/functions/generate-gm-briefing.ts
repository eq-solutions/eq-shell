// POST /.netlify/functions/generate-gm-briefing
//
// Body: { period_id: string }
// Auth: manager or platform_admin only.

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError, TenantRoutingMisconfiguredError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
// Sonnet for reliable structured JSON — Haiku occasionally truncates or adds preamble
const MODEL = 'claude-haiku-4-5';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const SYSTEM_PROMPT = `You are an AI analyst for a GM briefing dashboard at an electrical contracting company. Produce a JSON briefing from the job data provided.

Input fields: code=job code, pm=project manager, desc=description, cv=contract value, gap=cash gap (positive=deficit), gp=gross profit at completion, loss=forecast loss flag, pos=outstanding POs.
PM rollup fields: jobs=job count, cash=net cash position (negative=deficit), gp=GP forecast.

Rules:
- loss=true jobs are genuine operational losses — list in critical_jobs.
- Cash-negative with positive GP = invoice catch-up — list in watch_jobs.
- Tone: direct plain English. What the GM needs to DO. Dollar figures.

Return ONLY a raw JSON object — no markdown, no code fences, no explanation before or after. Use this exact structure:
{"top_concern":"string","critical_jobs":[{"job_code":"string","job_description":"string","job_manager":"string","contract_value":0,"cash_gap":0,"gp_forecast":0,"action":"string"}],"watch_jobs":[{"job_code":"string","job_description":"string","job_manager":"string","cash_gap":0,"gp_forecast":0,"action":"string"}],"pm_summary":[{"name":"string","job_count":0,"cash_position":0,"gp_forecast":0,"status":"red","note":"string"}],"portfolio_note":"string"}

For status use exactly one of: "red", "amber", "green". No other values.`;

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (session.role !== 'manager' && !session.is_platform_admin) {
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
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError || e instanceof TenantRoutingMisconfiguredError) {
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
    .select('job_manager, job_code, job_description, contract_valuation, jtd_invoicing, jtd_cost_val, gross_profit, gp_pct, outstanding_pos, cash_gap, is_cash_negative, is_forecast_loss, is_overhead')
    .eq('period_id', period_id);

  if (jErr || !jobs) return json(500, { error: 'db_error', detail: jErr?.message });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { error: 'ai_not_configured' });

  // Losses first, then largest cash gaps. Top 15 only — keeps Haiku prompt tiny (~2k tokens)
  const topJobs = [...jobs]
    .filter(j => !j.is_overhead && (j.is_forecast_loss || j.is_cash_negative))
    .sort((a, b) => {
      if (a.is_forecast_loss !== b.is_forecast_loss) return a.is_forecast_loss ? -1 : 1;
      return (b.cash_gap ?? 0) - (a.cash_gap ?? 0);
    })
    .slice(0, 15)
    .map(j => ({ code: j.job_code, pm: j.job_manager, desc: j.job_description.slice(0, 50), cv: Math.round(j.contract_valuation ?? 0), gap: Math.round(j.cash_gap ?? 0), gp: Math.round(j.gross_profit ?? 0), loss: j.is_forecast_loss, pos: Math.round(j.outstanding_pos ?? 0) }));

  // PM rollup (exclude overhead)
  const pmMap = new Map<string, { jobs: number; cash: number; gp: number }>();
  for (const j of jobs.filter(x => !x.is_overhead)) {
    const e = pmMap.get(j.job_manager) ?? { jobs: 0, cash: 0, gp: 0 };
    e.jobs++;
    e.cash -= (j.cash_gap ?? 0);   // negate: positive gap = deficit = negative for PM
    e.gp   += (j.gross_profit ?? 0);
    pmMap.set(j.job_manager, e);
  }
  const pmSummary = [...pmMap.entries()]
    .sort((a, b) => a[1].cash - b[1].cash)   // worst cash first
    .map(([name, s]) => ({ name, jobs: s.jobs, cash: Math.round(s.cash), gp: Math.round(s.gp) }));

  console.log(`[generate-gm-briefing] period=${period_id} total=${jobs.length} top_jobs=${topJobs.length} pms=${pmSummary.length}`);

  const userMessage = JSON.stringify({
    period: period.period_code,
    portfolio: {
      total_jobs: jobs.length,
      contract: Math.round(period.total_contract ?? 0),
      net_cash: Math.round(period.net_cash_position ?? 0),
      gp: Math.round(period.gp_at_completion ?? 0),
      gp_pct: ((period.overall_gp_pct ?? 0) * 100).toFixed(1),
      cash_neg_count: period.cash_neg_count,
      loss_count: period.forecast_loss_count,
    },
    top_jobs: topJobs,
    pm_rollup: pmSummary,
  });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: { text: string }) => b.text).join('');

    // Extract outermost JSON object, strip trailing commas, then parse
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      throw new Error(`No JSON in Claude response: ${raw.slice(0, 300)}`);
    }
    const jsonStr = raw.slice(jsonStart, jsonEnd + 1)
      .replace(/,(\s*[}\]])/g, '$1');  // strip trailing commas before } or ]
    const briefing = JSON.parse(jsonStr);

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
