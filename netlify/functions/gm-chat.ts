// POST /.netlify/functions/gm-chat
//
// Body: { period_id: string, messages: { role: 'user' | 'assistant', content: string }[] }
// Auth: manager or platform_admin only.

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 800;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (session.role !== 'manager' && !session.is_platform_admin) {
    return json(403, { error: 'forbidden' });
  }

  let body: { period_id?: string; messages?: ChatMessage[] };
  try {
    body = await req.json() as { period_id?: string; messages?: ChatMessage[] };
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const { period_id, messages } = body;
  if (!period_id || !Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'missing_fields' });
  }

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  const { data: period, error: pErr } = await db
    .from('gm_report_periods')
    .select('period_code, total_contract, net_cash_position, gp_at_completion, overall_gp_pct, cash_neg_count, forecast_loss_count, outstanding_pos, briefing')
    .eq('id', period_id)
    .single();

  if (pErr || !period) return json(404, { error: 'period_not_found' });

  // Fetch all jobs so the chat can answer questions about any job, including healthy ones.
  const { data: jobs } = await db
    .from('gm_report_jobs')
    .select('job_code, job_manager, job_description, wip_code, contract_valuation, jtd_invoicing, jtd_cost_val, gross_profit, gp_pct, outstanding_pos, cash_gap, is_cash_negative, is_forecast_loss, is_overhead')
    .eq('period_id', period_id)
    .order('cash_gap', { ascending: false });

  // Compact job rows — keep size down but include everything Claude needs to answer any question
  const jobRows = (jobs ?? []).map(j => ({
    code: j.job_code,
    pm:   j.job_manager,
    desc: (j.job_description ?? '').slice(0, 50),
    wip:  j.wip_code ?? '',
    cv:   Math.round(j.contract_valuation ?? 0),
    inv:  Math.round(j.jtd_invoicing ?? 0),
    cost: Math.round(j.jtd_cost_val ?? 0),
    gp:   Math.round(j.gross_profit ?? 0),
    gp_pct: Math.round((j.gp_pct ?? 0) * 100),
    gap:  Math.round(j.cash_gap ?? 0),   // positive = cash deficit
    pos:  Math.round(j.outstanding_pos ?? 0),
    loss: j.is_forecast_loss ? 1 : 0,
    neg:  j.is_cash_negative ? 1 : 0,
    oh:   j.is_overhead ? 1 : 0,
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { error: 'ai_not_configured' });

  const systemPrompt = `You are an AI analyst embedded in a GM briefing dashboard for an electrical contracting company.

Period: ${period.period_code}
Portfolio: $${Math.round(period.total_contract ?? 0).toLocaleString()} contract value, net cash $${Math.round(period.net_cash_position ?? 0).toLocaleString()}, GP $${Math.round(period.gp_at_completion ?? 0).toLocaleString()} (${((period.overall_gp_pct ?? 0) * 100).toFixed(1)}%), ${period.cash_neg_count} cash-negative jobs, ${period.forecast_loss_count} forecast losses, $${Math.round(period.outstanding_pos ?? 0).toLocaleString()} outstanding POs.

All jobs (${jobRows.length} rows — includes overhead codes):
Fields: code=job code, pm=project manager, desc=description (truncated), wip=WIP code, cv=contract value, inv=JTD invoicing, cost=JTD cost, gp=gross profit, gp_pct=GP%, gap=cash gap (positive=deficit), pos=outstanding POs, loss=forecast loss flag, neg=cash-negative flag, oh=overhead flag
${JSON.stringify(jobRows)}

${period.briefing ? `AI briefing highlights (top concerns):\n${JSON.stringify(period.briefing)}` : ''}

Rules:
- You have the COMPLETE job list above. Use it to answer any question — including healthy/positive jobs.
- Speak directly to the General Manager. Be direct and specific.
- Focus on what they need to DO: which PM to call, what question to ask, what to chase.
- Keep responses to 3-5 sentences unless asked for more detail.
- Use dollar figures. Name specific jobs and PMs.
- oh=1 jobs are internal overhead codes (estimating hours, defects/liability) — no revenue against them by design, not billing problems.
- gap > 0 = cash deficit (spent more than claimed). gap < 0 = cash-positive.
- Plain English only. No jargon.`;

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
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: messages.slice(-10),
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reply = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim();

    return json(200, { ok: true, message: reply });
  } catch (e) {
    captureServerError(e, { context: 'gm-chat', tenant_id: session.tenant_id });
    return json(500, { error: 'chat_failed' });
  }
});
